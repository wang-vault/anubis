import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getPaymentProvider } from "@/lib/integrations/payment";
import { handleWebhookEvent } from "@/lib/orders";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ===========================================================================
 * POST /api/webhooks/stenly — sumber kebenaran UTAMA status pembayaran
 * ===========================================================================
 * Stenly (StenlyPay) mengirim POST ke Callback URL project setiap kali status
 * transaksi berubah, dengan header (docs https://stenly.id/docs §Webhook):
 *   X-Stenly-Signature : hex(HMAC-SHA256(rawBody, STENLY_WEBHOOK_SECRET))
 *   X-Stenly-Timestamp : unix epoch milliseconds
 *   X-Stenly-Event     : payment.status_updated
 * Body: { event, data: { order_id, gross_amount, status, paid_at?, … }, timestamp }
 *
 * Urutan pengamanan:
 *  1. Baca RAW body (TIDAK di-parse sebelum signature diverifikasi — HMAC
 *     dihitung atas byte persis yang dikirim provider).
 *  2. Verifikasi signature dengan perbandingan constant-time; invalid → 403.
 *  3. Parse + normalisasi payload (mapping nama field khusus Stenly).
 *  4. Cari order via payment_id (= order_id Stenly) — fallback order_code.
 *  5. Validasi nominal terhadap total order; beda → JANGAN PAID.
 *  6. Update status idempotent (transisi bersyarat → webhook dobel = no-op).
 *  7. Notifikasi Telegram (sekali per order, dikirim setelah respons).
 *  8. Balas 200 {"received": true} < 10 detik, sesuai standar respon merchant
 *     Stenly, agar delivery tidak ditandai failed & diretry (1m/5m/30m/2j/6j).
 */

const MAX_BODY_BYTES = 64 * 1024;

/** Respons sukses standar yang diminta dokumentasi Stenly. */
function received(extra?: Record<string, unknown>) {
  return NextResponse.json({ received: true, ...extra });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: { code: "BAD_PAYLOAD", message: "Payload tidak valid" } },
      { status: 400 },
    );
  }

  const provider = getPaymentProvider();
  const signature = request.headers.get("x-stenly-signature");

  if (!provider.verifyWebhookSignature(raw, signature)) {
    log.warn("webhook_signature_invalid", {
      provider: provider.name,
      ip: request.headers.get("x-forwarded-for") ?? "n/a",
      hasSignature: Boolean(signature),
    });
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
    provider: provider.name,
    event: typeof body.event === "string" ? body.event : null,
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
    // detail hanya ada di log server (tidak pernah membocorkan data order).
    return received({ handled: outcome.handled, reason: outcome.reason ?? null });
  } catch (err) {
    // Error DB tak terduga → balas 500 supaya Stenly melakukan retry
    // (proses kita idempotent, retry aman).
    log.errorFrom("webhook_internal_error", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Gagal memproses webhook" } },
      { status: 500 },
    );
  }
}
