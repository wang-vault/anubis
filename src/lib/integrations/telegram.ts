import "server-only";
import { serverEnv, telegramConfigured } from "@/lib/env";
import { log } from "@/lib/logger";
import { formatRupiah } from "@/lib/money";
import type { OrderRow } from "@/lib/types";

/**
 * Notifikasi Telegram — HANYA ke penjual (owner), bukan ke buyer, tanpa OTP.
 *
 * Abstraction: `Notifier` interface agar layanan mudah diganti.
 * Kebijakan kegagalan (sesuai requirement):
 *   - Telegram gagal TIDAK boleh membatalkan status PAID.
 *   - Error dicatat ke log.
 *   - Duplicate prevented: order ditandai `telegram_notified_at` saat
 *     notifikasi "diklaim", webhook retry tidak akan mengirim dua kali.
 */
const TELEGRAM_TIMEOUT_MS = 6_000;

export interface PaidOrderInfo {
  orderCode: string;
  buyerName: string;
  buyerWhatsapp: string;
  productName: string;
  quantity: number;
  totalAmount: number;
}

export interface Notifier {
  notifyOrderPaid(order: PaidOrderInfo): Promise<{ ok: boolean; error?: string }>;
}

export function buildPaidOrderInfo(o: OrderRow): PaidOrderInfo {
  return {
    orderCode: o.order_code,
    buyerName: o.buyer_name_snapshot,
    buyerWhatsapp: o.buyer_whatsapp_snapshot,
    productName: o.product_name_snapshot,
    quantity: o.quantity,
    totalAmount: o.total_amount,
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
    "Status: LUNAS ✅",
    "",
    "Silakan proses pesanan.",
  ].join("\n");
}

class TelegramNotifier implements Notifier {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  async notifyOrderPaid(order: PaidOrderInfo): Promise<{ ok: boolean; error?: string }> {
    const text = formatPaidMessage(order);
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
