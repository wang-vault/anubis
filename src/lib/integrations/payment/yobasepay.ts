import "server-only";
import crypto from "node:crypto";
import { serverEnv, yobasepayConfigured } from "@/lib/env";
import { log } from "@/lib/logger";
import {
  PaymentProviderError,
  type CreatedPayment,
  type NormalizedWebhook,
  type PaymentProvider,
  type PaymentStatusResult,
} from "./types";
import {
  AMOUNT_KEYS,
  EXPIRY_KEYS,
  PAYMENT_URL_KEYS,
  TRX_ID_KEYS,
  asNumber,
  asString,
  extractQr,
  mapStatus,
  parseProviderDate,
  pickNumber,
  pickString,
  renderPayloadToUrl,
} from "./normalize";

/**
 * Implementasi YoBasePay — "Payment Engine" QRIS (bukan payment gateway).
 *
 * Kontrak yang dipakai (dokumentasi resmi pernah publik di
 * https://yobasepay.net/index.php?page=docs_public; per 2026-09-12 halaman itu
 * mensyaratkan login, jadi bentuk respons diverifikasi ulang lewat probe API):
 *
 *   GET {BASE}?action=createpayment&apikey={API_KEY}&amount={NOMINAL}
 *     → { status: true, data: { trx_id, amount, payment_url, qr_image,
 *         expired_at, environment } }
 *   GET {BASE}?action=checkstatus&apikey={API_KEY}&trxid={TRX_ID}
 *     → { status: true, data: { status: "SUCCESS" | "EXPIRED" | ..., amount } }
 *   Webhook (POST ke URL kita, dikirim saat SUCCESS/EXPIRED):
 *     body: { trxid, status, amount, ... }
 *     header: X-YoBasePay-Signature = HMAC-SHA256(rawBody, WEBHOOK_SECRET) hex
 *   Domain Lock: request wajib menyertakan header Referer/Origin = domain
 *   yang terdaftar di dashboard YoBasePay (dikirim dari NEXT_PUBLIC_SITE_URL).
 *
 * Probe 2026-09-12 (apikey palsu) → `{"status":false,"message":"Invalid API Key"}`:
 * base URL & bentuk request di atas masih valid untuk API V1.
 *
 * ⚠️ NAMA FIELD QR BERBEDA ANTAR PAKET (V1/V2/V3/V4/MyPG) dan tidak semuanya
 *    terdokumentasi publik. Semua varian yang dikenal ditangani di
 *    ./normalize.ts (URL absolut, path relatif, protocol-relative, base64,
 *    data URI, dan payload EMVCo). Bila provider hanya mengirim PAYLOAD,
 *    set `YOBASEPAY_QR_RENDER_URL` untuk merendernya jadi gambar.
 *    Untuk memastikan field apa yang sebenarnya dikirim akunmu, pakai
 *    GET /api/admin/payments/diagnose (lihat lib/integrations/payment/diagnose.ts).
 */

const PROVIDER_NAME = "yobasepay";
const FETCH_TIMEOUT_MS = 15_000;

async function apiGet(url: string, origin: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Origin: origin, Referer: origin },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new PaymentProviderError("provider_unreachable", err);
  }
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    log.error("yobasepay_bad_json", { httpStatus: res.status, preview: text.slice(0, 120) });
    throw new PaymentProviderError("provider_bad_response");
  }
  if (!res.ok || json.status !== true) {
    const message = typeof json.message === "string" ? json.message : "";
    // Pesan provider TIDAK dikirim ke buyer (lihat orders.ts) — hanya ke log
    // dan ke panel diagnosa admin.
    throw new PaymentProviderError(`provider_error ${res.status}`.trim(), message);
  }
  return (json.data ?? {}) as Record<string, unknown>;
}

export function createYoBasePayProvider(): PaymentProvider {
  const env = serverEnv();
  const base = env.YOBASEPAY_BASE_URL.replace(/\/+$/, "");
  const origin = new URL(env.NEXT_PUBLIC_SITE_URL).origin;
  // API key / webhook secret boleh kosong: artinya QRIS otomatis belum aktif
  // (mis. akun YoBasePay masih menunggu aktivasi). Semua panggilan ditolak
  // dengan error yang jelas, dan toko tetap jalan via pembayaran manual.
  const configured = yobasepayConfigured(env);

  return {
    name: PROVIDER_NAME,

    /** true bila kredensial YoBasePay terisi (dipakai UI utk menyembunyikan metode). */
    get isConfigured(): boolean {
      return configured;
    },

    async createPayment({ amount }): Promise<CreatedPayment> {
      if (!configured) {
        throw new PaymentProviderError(
          "provider_disabled",
          "YOBASEPAY_API_KEY / YOBASEPAY_WEBHOOK_SECRET belum diisi",
        );
      }
      // Dokumentasi V1: parameter hanya apikey + amount. Reference order TIDAK
      // dikirim ke API publik → pencocokan webhook lewat trx_id (payment_id
      // yang kita simpan di order).
      const url = new URL(base);
      url.searchParams.set("action", "createpayment");
      url.searchParams.set("apikey", env.YOBASEPAY_API_KEY);
      url.searchParams.set("amount", String(amount));

      const data = await apiGet(url.toString(), origin);

      const trx = pickString(data, TRX_ID_KEYS);
      if (!trx) {
        // Respons "sukses" tanpa ID transaksi → tidak bisa dicocokkan dengan
        // webhook/polling. Catat field yang ADA agar mudah dipetakan.
        log.error("yobasepay_missing_trxid", { fields: Object.keys(data) });
        throw new PaymentProviderError("provider_missing_trxid");
      }

      // Nominal final dari provider (sering = amount + kode unik). Disimpan
      // agar UI menampilkan angka yang sama dengan yang tertanam di QRIS.
      const charged = pickNumber(data, AMOUNT_KEYS);

      // --- QR: bagian yang paling sering berbeda antar paket/versi API ------
      const qr = extractQr(data, base);
      let qrImageUrl = qr.imageUrl;
      const qrPayload = qr.payload;

      if (!qrImageUrl && qrPayload) {
        // Provider mengirim string QRIS, bukan gambar. Coba render lewat
        // layanan yang dikonfigurasi penjual (opsional, wajib https).
        const rendered = renderPayloadToUrl(qrPayload, env.YOBASEPAY_QR_RENDER_URL);
        if (rendered) {
          qrImageUrl = rendered;
        } else {
          log.warn("yobasepay_qr_payload_only", {
            fields: Object.keys(data),
            fieldUsed: qr.fieldUsed,
            payloadLength: qrPayload.length,
            hint: "Isi YOBASEPAY_QR_RENDER_URL bila ingin payload dirender jadi gambar QR.",
          });
        }
      }
      if (!qrImageUrl && !qrPayload) {
        // Tidak ada QR sama sekali: buyer masih bisa membayar lewat
        // payment_url (bila ada). Log field yang tersedia = kunci diagnosa.
        log.warn("yobasepay_qr_missing", { fields: Object.keys(data) });
      }

      const paymentUrl = pickString(data, PAYMENT_URL_KEYS);
      const expiryRaw = pickString(data, EXPIRY_KEYS);

      return {
        paymentId: trx.value,
        paymentUrl: paymentUrl?.value ?? null,
        qrImageUrl,
        qrPayload,
        expiresAt: parseProviderDate(expiryRaw?.value ?? null, env.YOBASEPAY_EXPIRY_TZ_OFFSET),
        chargedAmount: charged?.value ?? null,
      };
    },

    async checkStatus(paymentId): Promise<PaymentStatusResult> {
      if (!configured) {
        throw new PaymentProviderError("provider_disabled", "YoBasePay belum dikonfigurasi");
      }
      const url = new URL(base);
      url.searchParams.set("action", "checkstatus");
      url.searchParams.set("apikey", env.YOBASEPAY_API_KEY);
      url.searchParams.set("trxid", paymentId);

      const data = await apiGet(url.toString(), origin);
      const status = asString(data.status);
      // Nominal dari provider (sudah termasuk kode unik) untuk validasi.
      const amount = asNumber(data.amount) ?? asNumber(data.receive_amount);
      if (status === null) {
        log.warn("yobasepay_checkstatus_no_status", { paymentId, fields: Object.keys(data) });
      }
      return { state: mapStatus(status), amount, raw: data };
    },

    verifyWebhookSignature(rawBody, signatureHeader): boolean {
      const secret = env.YOBASEPAY_WEBHOOK_SECRET;
      if (!secret || !signatureHeader) return false;
      // Dokumentasi: HMAC-SHA256 hex dari RAW body, header `X-YoBasePay-Signature`.
      const expected = crypto
        .createHmac("sha256", secret)
        .update(rawBody, "utf8")
        .digest("hex");
      const provided = signatureHeader.trim().replace(/^sha256=/i, "").toLowerCase();
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(provided, "hex");
      // Constant-time compare; panjang berbeda → pasti invalid.
      return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
    },

    normalizeWebhook(body): NormalizedWebhook {
      const paymentId = pickString(body, TRX_ID_KEYS);
      const amount = pickNumber(body, AMOUNT_KEYS);
      const status = asString(body.status);
      return {
        paymentId: paymentId?.value ?? null,
        orderCode: asString(body.order_id) ?? asString(body.reference) ?? null,
        state: mapStatus(status),
        amount: amount?.value ?? null,
        raw: body,
      };
    },
  };
}
