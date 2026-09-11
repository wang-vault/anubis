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
    <div className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Status Pesanan</h2>
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3 text-sm">
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                s.done ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-500"
              }`}
              aria-hidden
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span className={s.done ? "font-medium text-slate-900" : "text-slate-500"}>{s.label}</span>
          </li>
        ))}
      </ol>
      {order.order_status === "EXPIRED" && (
        <p className="alert-error mt-3">
          Pembayaran kadaluarsa. Pesanan dibatalkan — silakan buat order baru.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <OrderStatusBadge status={order.order_status} />
        <PaymentStatusBadge status={order.payment_status} />
      </div>
    </div>
  );
}
