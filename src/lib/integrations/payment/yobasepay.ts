import "server-only";
import crypto from "node:crypto";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import {
  PaymentProviderError,
  type CreatedPayment,
  type NormalizedWebhook,
  type PaymentProvider,
  type PaymentStatusResult,
  type ProviderPaymentState,
} from "./types";

/**
 * Implementasi YoBasePay — "Payment Engine" QRIS (bukan payment gateway).
 *
 * Sesuai dokumentasi RESMI publik:
 *   https://yobasepay.net/index.php?page=docs_public   (diakses 2026-09-11)
 *
 *   GET {BASE}?action=createpayment&apikey={API_KEY}&amount={NOMINAL}
 *     → { status: true, data: { trx_id, amount, payment_url, qr_image,
 *         expired_at, environment } }
 *   GET {BASE}?action=checkstatus&apikey={API_KEY}&trxid={TRX_ID}
 *     → { status: true, data: { status: "SUCCESS" | "EXPIRED" | ..., amount, ... } }
 *   Webhook (POST ke URL kita, dikirim saat SUCCESS/EXPIRED):
 *     body: { trxid, status, amount, ... }
 *     header: X-YoBasePay-Signature = HMAC-SHA256(rawBody, WEBHOOK_SECRET) hex
 *   Domain Lock: request wajib menyertakan header Referer/Origin = domain
 *   yang terdaftar di dashboard YoBasePay (kirim NEXT_PUBLIC_SITE_URL).
 *
 * ⚠️ FIELD YANG BELUM TERDOKUMENTASI PASTI (per tanggal di atas) diberi
 *    tanda [VERIFIKASI] dan kode ditulis toleran terhadap beberapa nama field.
 *    Cek dashboard dokumentasi akun Anda (login → Docs) sebelum production.
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
    log.error("yobasepay_bad_json", { httpStatus: res.status });
    throw new PaymentProviderError("provider_bad_response");
  }
  if (!res.ok || json.status !== true) {
    const message = typeof json.message === "string" ? json.message : "";
    throw new PaymentProviderError(`provider_error ${res.status}`.trim(), message);
  }
  return (json.data ?? {}) as Record<string, unknown>;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * "2026-01-01 12:00:00" (tanpa zona waktu, diasumsikan WIB) → ISO string.
 * [VERIFIKASI] format tanggal bisa berubah — parser toleran ISO juga.
 */
function parseProviderDate(v: unknown, tzOffset: string): string | null {
  const s = asString(v);
  if (!s) return null;
  const iso = s.includes("T") ? s : `${s.replace(" ", "T")}${tzOffset}`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function mapStatus(status: string | null): ProviderPaymentState | "unknown" {
  switch ((status ?? "").toUpperCase()) {
    case "SUCCESS":
    case "SUCCESSFUL":
    case "PAID":
    case "COMPLETED":
      return "paid";
    case "EXPIRED":
      return "expired";
    case "FAILED":
    case "CANCELLED":
    case "CANCELED":
    case "REVERSED":
    case "REFUNDED":
      return "failed";
    case "PENDING":
    case "WAITING_PAYMENT":
    case "WAITING":
    case "UNPAID":
    case "IN_PROGRESS":
      return "pending";
    default:
      return "unknown";
  }
}

export function createYoBasePayProvider(): PaymentProvider {
  const env = serverEnv();
  const base = env.YOBASEPAY_BASE_URL.replace(/\/+$/, "");
  const origin = new URL(env.NEXT_PUBLIC_SITE_URL).origin;

  return {
    name: PROVIDER_NAME,

    async createPayment({ amount }): Promise<CreatedPayment> {
      // Dokumentasi: parameter hanya apikey + amount. Reference order TIDAK
      // dikirim ke API publik → pencocokan webhook lewat trx_id (payment_id
      // yang kita simpan di order). [VERIFIKASI] apakah API versi akun Anda
      // mendukung parameter reference/order_id tambahan.
      const url = new URL(base);
      url.searchParams.set("action", "createpayment");
      url.searchParams.set("apikey", env.YOBASEPAY_API_KEY);
      url.searchParams.set("amount", String(amount));

      const data = await apiGet(url.toString(), origin);
      const paymentId = asString(data.trx_id) ?? asString(data.trxid);
      if (!paymentId) throw new PaymentProviderError("provider_missing_trxid");

      return {
        paymentId,
        paymentUrl: asString(data.payment_url),
        // [VERIFIKASI] contoh dokumentasi memakai `qr_image`; sebagian
        // versi memakai `qr_image_url` / `qris_url`.
        qrImageUrl:
          asString(data.qr_image) ??
          asString(data.qr_image_url) ??
          asString(data.qris_url),
        expiresAt: parseProviderDate(data.expired_at, env.YOBASEPAY_EXPIRY_TZ_OFFSET),
      };
    },

    async checkStatus(paymentId): Promise<PaymentStatusResult> {
      const url = new URL(base);
      url.searchParams.set("action", "checkstatus");
      url.searchParams.set("apikey", env.YOBASEPAY_API_KEY);
      url.searchParams.set("trxid", paymentId);

      const data = await apiGet(url.toString(), origin);
      const status = asString(data.status);
      // Nominal dari provider (sudah termasuk kode unik) untuk validasi.
      const amount = asNumber(data.amount) ?? asNumber(data.receive_amount);
      if (status === null) {
        log.warn("yobasepay_checkstatus_no_status", { paymentId });
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
      const paymentId =
        asString(body.trxid) ?? asString(body.trx_id) ?? asString(body.transaction_id);
      const amount = asNumber(body.amount) ?? asNumber(body.receive_amount);
      const status = asString(body.status);
      return {
        paymentId,
        orderCode: asString(body.order_id) ?? asString(body.reference) ?? null,
        state: mapStatus(status),
        amount,
        raw: body,
      };
    },
  };
}
