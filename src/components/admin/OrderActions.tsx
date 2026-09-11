import Link from "next/link";
import { orderTransitionAction, refreshOrderPaymentAction } from "@/app/admin/actions";
import { sellerWaMessage, waMeUrl } from "@/lib/phone";
import type { OrderRow } from "@/lib/types";
import { ActionButton } from "@/components/ActionButton";

/**
 * Aksi per-order untuk penjual. Masing-masing = form POST ke server action
 * (guard role + state machine divalidasi ulang di server). Tombol menampilkan
 * keadaan sibuk agar tidak terjadi double-submit.
 */
export function OrderActions({
  order,
  back,
  compact = false,
}: {
  order: OrderRow;
  back: string;
  compact?: boolean;
}) {
  const canProcess = order.order_status === "PAID" && order.payment_status === "PAID";
  const canComplete =
    order.payment_status === "PAID" && ["PAID", "PROCESSING"].includes(order.order_status);
  const canExpire = order.order_status === "PENDING";
  const canRefresh = order.payment_status === "PENDING";
  const waHref = order.buyer_whatsapp_snapshot
    ? waMeUrl(
        order.buyer_whatsapp_snapshot,
        sellerWaMessage({
          buyerName: order.buyer_name_snapshot,
          orderCode: order.order_code,
          storeName: process.env.NEXT_PUBLIC_SITE_NAME ?? "Toko Saya",
        }),
      )
    : null;
  const cls = compact ? "btn-secondary btn-sm" : "btn-secondary btn-sm";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/admin/orders/${order.order_code}`} className={cls}>
        Detail →
      </Link>
      {waHref && (
        <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm">
          💬 Chat WhatsApp
        </a>
      )}
      {canProcess && (
        <form action={orderTransitionAction} className="inline">
          <input type="hidden" name="action" value="process" />
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="back" value={back} />
          <ActionButton className="btn-secondary btn-sm" type="submit" pendingText="Memproses…">
            ▶ Proses Pesanan
          </ActionButton>
        </form>
      )}
      {canComplete && (
        <form action={orderTransitionAction} className="inline">
          <input type="hidden" name="action" value="complete" />
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="back" value={back} />
          <ActionButton className="btn-primary btn-sm" type="submit" pendingText="Menyelesaikan…">
            ✓ Tandai Selesai
          </ActionButton>
        </form>
      )}
      {canRefresh && (
        <form action={refreshOrderPaymentAction} className="inline">
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="back" value={back} />
          <ActionButton
            className={cls}
            type="submit"
            pendingText="Mengecek…"
            title="Tanya status ke YoBasePay (maks 1x/10 dtk)"
          >
            ⟳ Cek Pembayaran
          </ActionButton>
        </form>
      )}
      {canExpire && (
        <form action={orderTransitionAction} className="inline">
          <input type="hidden" name="action" value="expire" />
          <input type="hidden" name="orderId" value={order.id} />
          <input type="hidden" name="back" value={back} />
          <ActionButton
            className="btn-danger btn-sm"
            type="submit"
            pendingText="Membatalkan…"
            formEncType="application/x-www-form-urlencoded"
          >
            ✕ Expire
          </ActionButton>
        </form>
      )}
    </div>
  );
}
