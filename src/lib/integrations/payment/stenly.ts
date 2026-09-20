import "server-only";
import crypto from "node:crypto";
import { serverEnv, stenlyConfigured } from "@/lib/env";
import { log } from "@/lib/logger";
import {
  PaymentProviderError,
  type CreatePaymentInput,
  type CreatedPayment,
  type NormalizedWebhook,
  type PaymentProvider,
  type PaymentStatusResult,
} from "./types";
import {
  STENLY_AMOUNT_KEYS,
  STENLY_EXPIRY_KEYS,
  STENLY_ORDER_ID_KEYS,
  STENLY_PAYMENT_URL_KEYS,
  STENLY_QR_IMAGE_KEYS,
  STENLY_QR_PAYLOAD_KEYS,
  asString,
  mapStenlyStatus,
  parseProviderDate,
  pickNumber,
  pickString,
  sanitizeProviderUrl,
} from "./normalize";
import { renderQrisToDataUri } from "./qr-render";

/**
 * ===========================================================================
 * ADAPTER STENLY (StenlyPay) — payment gateway QRIS otomatis
 * ===========================================================================
 * Ditulis terhadap dokumentasi resmi https://stenly.id/docs (diakses
 * 2026-09-20). Kontrak yang dipakai, apa adanya dari dokumentasi:
 *
 *  1. CREATE CHARGE
 *     POST {BASE}/api/v1/charge
 *     Header : Content-Type: application/json
 *              x-api-key: sk_live_… (atau sk_test_… untuk sandbox)
 *     Body   : { order_id, gross_amount, customer_name?, customer_email?,
 *                customer_phone?, expiry_minutes? }
 *     201    : { status: "success", data: { order_id, project_slug,
 *                gross_amount, currency, status, payment_method, qr_string,
 *                qr_image_url, payment_url, expires_at, created_at } }
 *     Catatan: `order_id` WAJIB unik (maks 100 karakter), `gross_amount`
 *     minimum 1000. Memanggil ulang dengan order_id + nominal SAMA
 *     mengembalikan transaksi yang sudah ada (idempoten); nominal berbeda → 409.
 *
 *  2. CEK STATUS
 *     GET {BASE}/api/v1/status/:order_id   (header x-api-key)
 *     Status: pending | paid | expired | cancelled
 *             sandbox: sandbox_trx_* ; rekonsiliasi: paid_after_expiry
 *
 *  3. WEBHOOK (POST ke callback URL project)
 *     Header : X-Stenly-Signature  = hex HMAC-SHA256(raw body, whsec_…)
 *              X-Stenly-Timestamp  = unix epoch ms
 *              X-Stenly-Event      = payment.status_updated
 *     Body   : { event, data: { order_id, project_slug, gross_amount, currency,
 *                payment_method, status, paid_at?, journal_id? }, timestamp }
 *     Merchant wajib balas 200 `{"received": true}` < 10 detik. Retry otomatis
 *     s.d. 6× (1m, 5m, 30m, 2j, 6j).
 *
 * KEPUTUSAN PENTING (identitas transaksi):
 *   Stenly tidak mengembalikan ID transaksi terpisah — kunci transaksi adalah
 *   `order_id` yang KITA kirim, dan itu pula yang dipakai endpoint status &
 *   payload webhook. Karena itu `paymentId` = `order_code` Anubis, disimpan ke
 *   `orders.payment_id`. Ini tetap cocok dengan pencarian order di webhook
 *   (lewat payment_id maupun order_code).
 *
 * KEPUTUSAN PENTING (gambar QR):
 *   `qr_image_url` dari Stenly membawa secret key di query string (lihat contoh
 *   resmi), jadi TIDAK PERNAH dikirim ke browser. QR dirender lokal dari
 *   `qr_string` di ./qr-render.ts.
 */

const PROVIDER_NAME = "stenly";
const FETCH_TIMEOUT_MS = 15_000;
/** Batas nominal per dokumentasi (§FAQ): Rp1.000 s.d. Rp10.000.000. */
export const STENLY_MIN_AMOUNT = 1_000;
export const STENLY_MAX_AMOUNT = 10_000_000;
/** `order_id` maksimal 100 karakter (docs §Parameter Request Body). */
export const STENLY_MAX_ORDER_ID_LENGTH = 100;

interface StenlyEnvelope {
  status?: unknown;
  message?: unknown;
  data?: unknown;
}

/** Ambil `data` dari amplop respons Stenly, atau lempar PaymentProviderError. */
function unwrap(json: StenlyEnvelope, httpStatus: number): Record<string, unknown> {
  const message = typeof json.message === "string" ? json.message : "";
  const okStatus = json.status === "success" || json.status === true;
  if (httpStatus < 200 || httpStatus >= 300 || !okStatus) {
    // Pesan provider TIDAK pernah dikirim ke buyer (lihat orders.ts) — hanya ke
    // log & panel diagnosa admin.
    throw new PaymentProviderError(`provider_error ${httpStatus}`.trim(), message);
  }
  const data = json.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new PaymentProviderError("provider_bad_response", message);
  }
  return data as Record<string, unknown>;
}

async function apiRequest(
  url: string,
  apiKey: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<Record<string, unknown>> {
  const method = init?.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
    // Docs §Autentikasi: header `x-api-key` berisi SECRET key (server-only).
    "x-api-key": apiKey,
  };
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new PaymentProviderError("provider_unreachable", err);
  }

  const text = await res.text();
  let json: StenlyEnvelope;
  try {
    json = JSON.parse(text) as StenlyEnvelope;
  } catch {
    log.error("stenly_bad_json", { httpStatus: res.status, preview: text.slice(0, 120) });
    throw new PaymentProviderError("provider_bad_response");
  }
  return unwrap(json, res.status);
}

/**
 * Payload webhook Stenly berbentuk { event, data: {...}, timestamp }.
 * Fungsi ini mengembalikan objek `data` — atau body itu sendiri bila suatu saat
 * provider mengirim payload datar (tidak merusak apa pun bila tidak).
 */
function webhookData(body: Record<string, unknown>): Record<string, unknown> {
  const data = body.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return body;
}

export function createStenlyProvider(): PaymentProvider {
  const env = serverEnv();
  const base = env.STENLY_BASE_URL.replace(/\/+$/, "");
  // Secret key & webhook secret boleh kosong: artinya QRIS otomatis belum aktif
  // (mis. akun Stenly masih disiapkan). Semua panggilan ditolak dengan error
  // yang jelas, dan toko tetap jalan via pembayaran manual.
  const configured = stenlyConfigured(env);

  return {
    name: PROVIDER_NAME,

    /** true bila kredensial Stenly terisi (dipakai UI utk menyembunyikan metode). */
    get isConfigured(): boolean {
      return configured;
    },

    async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
      if (!configured) {
        throw new PaymentProviderError(
          "provider_disabled",
          "STENLY_API_KEY / STENLY_WEBHOOK_SECRET belum diisi",
        );
      }

      const amount = Math.trunc(input.amount);
      // Batas provider divalidasi di sini supaya buyer mendapat kegagalan cepat
      // & jelas di log, bukan error 400 mentah dari gateway.
      if (!Number.isFinite(amount) || amount < STENLY_MIN_AMOUNT) {
        throw new PaymentProviderError("amount_below_minimum", `min ${STENLY_MIN_AMOUNT}`);
      }
      if (amount > STENLY_MAX_AMOUNT) {
        throw new PaymentProviderError("amount_above_maximum", `max ${STENLY_MAX_AMOUNT}`);
      }
      const orderId = input.orderCode.trim();
      if (!orderId || orderId.length > STENLY_MAX_ORDER_ID_LENGTH) {
        throw new PaymentProviderError("invalid_order_id");
      }

      // Docs §Create Charge. Field opsional hanya dikirim bila ada isinya.
      const body: Record<string, unknown> = {
        order_id: orderId,
        gross_amount: amount,
        expiry_minutes: env.STENLY_EXPIRY_MINUTES,
      };
      const customerName = asString(input.customerName);
      const customerEmail = asString(input.customerEmail);
      const customerPhone = asString(input.customerPhone);
      if (customerName) body.customer_name = customerName;
      if (customerEmail) body.customer_email = customerEmail;
      if (customerPhone) body.customer_phone = customerPhone;

      const data = await apiRequest(`${base}/api/v1/charge`, env.STENLY_API_KEY, {
        method: "POST",
        body,
      });

      // Identitas transaksi = order_id (dipakai endpoint status & webhook).
      const returnedOrderId = pickString(data, STENLY_ORDER_ID_KEYS);
      if (!returnedOrderId) {
        // Respons "sukses" tanpa order_id → tidak bisa dicocokkan dengan
        // webhook/polling. Catat field yang ADA agar mudah didiagnosa.
        log.error("stenly_missing_order_id", { fields: Object.keys(data) });
        throw new PaymentProviderError("provider_missing_order_id");
      }
      if (returnedOrderId.value !== orderId) {
        // Gateway mengembalikan transaksi milik order lain → JANGAN dipakai.
        log.error("stenly_order_id_mismatch", { sent: orderId, got: returnedOrderId.value });
        throw new PaymentProviderError("provider_order_id_mismatch");
      }

      // Nominal yang benar-benar ditagih provider (docs: sama dgn gross_amount).
      const charged = pickNumber(data, STENLY_AMOUNT_KEYS);
      if (charged && charged.value !== amount) {
        // Beda nominal = pembeli akan membayar angka yang bukan harga kita.
        log.error("stenly_amount_mismatch", { sent: amount, got: charged.value });
        throw new PaymentProviderError("provider_amount_mismatch");
      }

      // --- QR: dirender LOKAL dari qr_string (lihat catatan keamanan di atas).
      const qrPayload = pickString(data, STENLY_QR_PAYLOAD_KEYS)?.value ?? null;
      let qrImageUrl: string | null = null;
      if (qrPayload) {
        qrImageUrl = await renderQrisToDataUri(qrPayload);
      } else {
        log.warn("stenly_qr_string_missing", { fields: Object.keys(data) });
      }
      if (!qrImageUrl) {
        // Buyer masih bisa membayar lewat payment_url. Sebutkan apakah provider
        // mengirim qr_image_url (yang sengaja tidak dipakai) untuk diagnosa.
        log.warn("stenly_qr_unavailable", {
          hasPayload: Boolean(qrPayload),
          providerImageField: Boolean(pickString(data, STENLY_QR_IMAGE_KEYS)),
        });
      }

      // payment_url dibersihkan dari query-param kredensial sebelum disimpan:
      // pada project sandbox URL-nya membawa API key test (docs §QR Image &
      // Payment Page) dan nilai ini berakhir di halaman buyer.
      const paymentUrlRaw = pickString(data, STENLY_PAYMENT_URL_KEYS)?.value ?? null;
      const paymentUrl = sanitizeProviderUrl(paymentUrlRaw);
      if (paymentUrl.hadSecret) {
        log.warn("stenly_payment_url_secret_stripped", { orderCode: orderId });
      }

      const expiryRaw = pickString(data, STENLY_EXPIRY_KEYS)?.value ?? null;

      return {
        paymentId: returnedOrderId.value,
        paymentUrl: paymentUrl.url,
        qrImageUrl,
        qrPayload,
        expiresAt: parseProviderDate(expiryRaw),
        chargedAmount: charged?.value ?? amount,
      };
    },

    async checkStatus(paymentId): Promise<PaymentStatusResult> {
      if (!configured) {
        throw new PaymentProviderError("provider_disabled", "Stenly belum dikonfigurasi");
      }
      const id = paymentId.trim();
      if (!id) throw new PaymentProviderError("invalid_order_id");

      // Docs: GET /api/v1/status/:order_id
      const url = `${base}/api/v1/status/${encodeURIComponent(id)}`;
      const data = await apiRequest(url, env.STENLY_API_KEY);

      const status = asString(data.status);
      const amount = pickNumber(data, STENLY_AMOUNT_KEYS)?.value ?? null;
      if (status === null) {
        log.warn("stenly_status_field_missing", { fields: Object.keys(data) });
      }
      return { state: mapStenlyStatus(status), amount, raw: data };
    },

    verifyWebhookSignature(rawBody, signatureHeader): boolean {
      const secret = env.STENLY_WEBHOOK_SECRET;
      if (!secret || !signatureHeader) return false;
      // Docs §Webhook: hex HMAC-SHA256 atas payload MENTAH memakai webhook secret.
      const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
      const provided = signatureHeader.trim().replace(/^sha256=/i, "").toLowerCase();
      // Panjang/format berbeda → pasti invalid (Buffer.from akan memotong hex
      // ganjil/ilegal, jadi cek panjang dilakukan sebelum timingSafeEqual).
      if (!/^[0-9a-f]+$/.test(provided) || provided.length !== expected.length) return false;
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(provided, "hex");
      return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
    },

    normalizeWebhook(body): NormalizedWebhook {
      // Payload bersarang: { event, data: {…}, timestamp }.
      const data = webhookData(body);
      const orderId = pickString(data, STENLY_ORDER_ID_KEYS)?.value ?? null;
      const amount = pickNumber(data, STENLY_AMOUNT_KEYS)?.value ?? null;
      const state = mapStenlyStatus(asString(data.status));
      return {
        // Stenly memakai order_id sebagai identitas transaksi → keduanya sama.
        paymentId: orderId,
        orderCode: orderId,
        state,
        amount,
        raw: body,
      };
    },
  };
}
