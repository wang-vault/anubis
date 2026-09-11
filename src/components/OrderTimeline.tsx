import { OrderStatusBadge, PaymentStatusBadge } from "@/components/StatusBadge";
import type { OrderRow } from "@/lib/types";

/** Timeline status order — memakai status REAL dari database. */
export function OrderTimeline({ order }: { order: OrderRow }) {
  const paid =
    order.payment_status === "PAID" ||
    ["PAID", "PROCESSING", "DONE"].includes(order.order_status);
  const processing = ["PROCESSING", "DONE"].includes(order.order_status);
  const done = order.order_status === "DONE";

  const steps = [
    { label: "Order dibuat", done: true },
    { label: "Pembayaran berhasil", done: paid },
    { label: "Pesanan diproses penjual", done: processing },
    { label: "Pesanan selesai", done },
  ];

  return (
    <div className="card p-4 sm:p-5">
      <div className="paper-heading">
        <p className="section-kicker">Edisi status</p>
        <h2 className="mt-1 text-lg font-black">Perjalanan pesanan</h2>
      </div>
      <ol className="order-timeline mt-4">
        {steps.map((s, i) => (
          <li key={s.label} className={`order-timeline-item ${s.done ? "is-done" : ""}`}>
            <span className="order-timeline-dot" aria-hidden>
              {s.done ? "✓" : i + 1}
            </span>
            <span className="order-timeline-label">{s.label}</span>
          </li>
        ))}
      </ol>
      {order.order_status === "EXPIRED" && (
        <p className="alert-error mt-4">
          Pembayaran kadaluarsa. Pesanan dibatalkan — silakan buat order baru.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-dotted border-slate-300 pt-3">
        <OrderStatusBadge status={order.order_status} />
        <PaymentStatusBadge status={order.payment_status} />
      </div>
    </div>
  );
}
