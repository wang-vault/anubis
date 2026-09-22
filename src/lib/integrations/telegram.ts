import "server-only";
import { serverEnv, telegramConfigured } from "@/lib/env";
import { log } from "@/lib/logger";
import { formatRupiah } from "@/lib/money";
import type { OrderRow } from "@/lib/types";
import { paymentMethodLabel } from "@/lib/payment-methods";

/**
 * Notifikasi Telegram — HANYA ke penjual (owner), bukan ke buyer, tanpa OTP.
 *
 * Abstraction: `Notifier` interface agar layanan mudah diganti.
 * Kebijakan kegagalan (sesuai requirement):
 *   - Telegram gagal TIDAK boleh membatalkan status PAID.
 *   - Error dicatat ke log.
 *   - Duplicate prevented: order ditandai `telegram_notified_at` /
 *     `manual_claim_notified_at` begitu notifikasi terkirim, sehingga klik
 *     ulang dari dashboard tidak mengirim pesan kedua.
 */
const TELEGRAM_TIMEOUT_MS = 6_000;

export interface PaidOrderInfo {
  orderCode: string;
  buyerName: string;
  buyerWhatsapp: string;
  productName: string;
  quantity: number;
  totalAmount: number;
  /** Metode bayar (untuk menandai order hasil verifikasi manual). */
  paymentMethod?: string | null;
}

/** Klaim transfer manual dari buyer → penjual harus cek mutasi lalu konfirmasi. */
export interface ManualClaimInfo {
  orderCode: string;
  buyerName: string;
  buyerWhatsapp: string;
  productName: string;
  quantity: number;
  /** Nominal yang diminta (total + kode unik). */
  expectedAmount: number;
  note: string;
  reference: string;
  claimedAt: string;
}

export interface Notifier {
  notifyOrderPaid(order: PaidOrderInfo): Promise<{ ok: boolean; error?: string }>;
  /** Buyer mengklaim sudah transfer (pembayaran manual). */
  notifyManualPaymentClaim(claim: ManualClaimInfo): Promise<{ ok: boolean; error?: string }>;
}

export function buildPaidOrderInfo(o: OrderRow): PaidOrderInfo {
  return {
    orderCode: o.order_code,
    buyerName: o.buyer_name_snapshot,
    buyerWhatsapp: o.buyer_whatsapp_snapshot,
    productName: o.product_name_snapshot,
    quantity: o.quantity,
    totalAmount: o.total_amount,
    paymentMethod: o.payment_method,
  };
}

export function buildManualClaimInfo(o: OrderRow): ManualClaimInfo {
  return {
    orderCode: o.order_code,
    buyerName: o.buyer_name_snapshot,
    buyerWhatsapp: o.buyer_whatsapp_snapshot,
    productName: o.product_name_snapshot,
    quantity: o.quantity,
    expectedAmount: o.charged_amount ?? o.total_amount,
    note: o.manual_claim_note,
    reference: o.manual_claim_reference,
    claimedAt: o.manual_claim_at ?? new Date().toISOString(),
  };
}

export function formatPaidMessage(order: PaidOrderInfo): string {
  return [
    "🔔 PESANAN BARU",
    "",
    `Order: #${order.orderCode}`,
    `Buyer: ${order.buyerName || "-"}`,
    `WhatsApp: ${order.buyerWhatsapp || "-"}`,
    `Produk: ${order.productName}`,
    `Jumlah: ${order.quantity}`,
    `Total: ${formatRupiah(order.totalAmount)}`,
    `Metode: ${paymentMethodLabel(order.paymentMethod)}`,
    "Status: LUNAS ✅",
    "",
    "Silakan proses pesanan.",
  ].join("\n");
}

/**
 * Pesan "buyer mengklaim sudah transfer" — penjual harus cek mutasi rekening/
 * e-wallet lalu menekan "Konfirmasi Pembayaran" di dashboard.
 */
export function formatManualClaimMessage(claim: ManualClaimInfo): string {
  const claimedAt = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(claim.claimedAt));
  return [
    "🧾 KLAIM TRANSFER MANUAL",
    "",
    `Order: #${claim.orderCode}`,
    `Buyer: ${claim.buyerName || "-"}`,
    `WhatsApp: ${claim.buyerWhatsapp || "-"}`,
    `Produk: ${claim.productName} × ${claim.quantity}`,
    `Ditagihkan: ${formatRupiah(claim.expectedAmount)}`,
    claim.reference ? `No. referensi: ${claim.reference}` : null,
    claim.note ? `Catatan buyer: ${claim.note}` : null,
    `Diklaim: ${claimedAt} WIB`,
    "",
    "Cek mutasi rekening/e-wallet-mu. Kalau uangnya masuk, buka dashboard → order ini →",
    "tekan \"Konfirmasi Pembayaran\".",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

class TelegramNotifier implements Notifier {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  async notifyOrderPaid(order: PaidOrderInfo): Promise<{ ok: boolean; error?: string }> {
    return this.send(formatPaidMessage(order));
  }

  async notifyManualPaymentClaim(claim: ManualClaimInfo): Promise<{ ok: boolean; error?: string }> {
    return this.send(formatManualClaimMessage(claim));
  }

  private async send(text: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          // disable_web_page_preview: chat ID & token tidak di-log.
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        // Jangan pernah log response Telegram penuh berisi konfigurasi; status + snippet aman.
        log.error("telegram_send_failed", { httpStatus: res.status, body: body.slice(0, 300) });
        return { ok: false, error: `telegram_http_${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("telegram_send_error", { message });
      return { ok: false, error: message };
    }
  }
}

/** Bila env Telegram kosong (mis. dev lokal): jangan kirim apa pun, cukup log. */
class DisabledNotifier implements Notifier {
  async notifyOrderPaid(order: PaidOrderInfo): Promise<{ ok: boolean; error?: string }> {
    log.warn("telegram_disabled_skip_notify", { orderCode: order.orderCode });
    return { ok: false, error: "telegram_not_configured" };
  }

  async notifyManualPaymentClaim(claim: ManualClaimInfo): Promise<{ ok: boolean; error?: string }> {
    log.warn("telegram_disabled_skip_notify", {
      orderCode: claim.orderCode,
      kind: "manual_claim",
    });
    return { ok: false, error: "telegram_not_configured" };
  }
}

let cached: Notifier | null = null;

export function getNotifier(): Notifier {
  if (cached) return cached;
  const env = serverEnv();
  cached = telegramConfigured(env)
    ? new TelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID)
    : new DisabledNotifier();
  return cached;
}
