import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getPaymentProvider } from "@/lib/integrations/payment";
import { handleWebhookEvent } from "@/lib/orders";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ===========================================================================
 * POST /api/webhooks/yobasepay — sumber kebenaran UTAMA status pembayaran
 * ===========================================================================
 * YoBasePay mengirim POST saat transaksi SUCCESS / EXPIRED dengan header
 * `X-YoBasePay-Signature: hex(HMAC-SHA256(rawBody, YOBASEPAY_WEBHOOK_SECRET))`
 * (sesuai dokumentasi resmi yobasepay.net → docs_public §Webhook).
 *
 * Urutan pengamanan:
 *  1. Read RAW body (tidak di-parse ulang sebelum signature dicek — HMAC
 *     dihitung atas byte persis yang dikirim provider).
 *  2. Verifikasi signature dengan perbandingan constant-time; invalid → 403.
 *  3. Parse + normalisasi payload.
 *  4. Cari order via payment_id (trxid) — fallback order_code.
 *  5. Validasi nominal (amount ∈ [total, total+toleransi kode unik]).
 *  6. Update status idempotent (transisi bersyarat → webhook dobel = no-op).
 *  7. Notifikasi Telegram (sekali per order, dikirim setelah respons 200).
 *  8. Selalu balas 200 untuk event valid sehingga provider berhenti retry.
 */

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { code: "BAD_PAYLOAD", message: "Payload tidak valid" } }, { status: 400 });
  }

  const provider = getPaymentProvider();
  const signature = request.headers.get("x-yobasepay-signature");

  if (!provider.verifyWebhookSignature(raw, signature)) {
    log.warn("webhook_signature_invalid", { ip: request.headers.get("x-forwarded-for") ?? "n/a" });
    return NextResponse.json(
      { error: { code: "INVALID_SIGNATURE", message: "Signature tidak valid" } },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_JSON", message: "Body bukan JSON" } },
      { status: 400 },
    );
  }

  const event = provider.normalizeWebhook(body);
  log.info("webhook_received", {
    paymentId: event.paymentId,
    state: event.state,
    amount: event.amount,
  });

  try {
    const outcome = await handleWebhookEvent({
      provider,
      paymentId: event.paymentId,
      orderCode: event.orderCode,
      state: event.state,
      amount: event.amount,
    });
    // 200 untuk processed maupun ignored agar provider tidak retry terus;
    // detail hanya ada di log server.
    return NextResponse.json({ ok: true, handled: outcome.handled, reason: outcome.reason ?? null });
  } catch (err) {
    // Error DB tak terduga → balas 500 supaya provider melakukan retry
    // (proses kita idempotent, retry aman).
    log.errorFrom("webhook_internal_error", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Gagal memproses webhook" } },
      { status: 500 },
    );
  }
}
