import type { Metadata } from "next";
import Link from "next/link";
import { getAdminStats, listAdminOrders } from "@/lib/orders";
import { formatRupiah } from "@/lib/money";
import { formatDateTimeId } from "@/lib/dates";
import { StatCard } from "@/components/UiBits";
import { OrderActions } from "@/components/admin/OrderActions";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/StatusBadge";
import type { OrderRow } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard Penjual" };

export default async function AdminDashboardPage() {
  const [stats, toProcess] = await Promise.all([
    getAdminStats(),
    listAdminOrders({ status: "PAID" }),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Order hari ini" value={stats.ordersToday} />
        <StatCard label="Perlu diproses" value={stats.needProcessing} accent="text-emerald-600" />
        <StatCard label="Sedang diproses" value={stats.processing} accent="text-sky-600" />
        <StatCard label="Belum lunas" value={stats.pendingPayment} accent="text-amber-600" />
        <StatCard label="Selesai hari ini" value={stats.doneToday} />
        <StatCard label="Revenue bulan ini" value={formatRupiah(stats.revenueMonth)} accent="text-brand-700" />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">🔔 Perlu diproses (LUNAS)</h2>
          <Link href="/admin/orders?status=PAID" className="text-sm font-medium text-brand-700 hover:underline">
            Semua →
          </Link>
        </div>
        {toProcess.length === 0 ? (
          <div className="card p-8 text-center text-sm text-slate-500">
            Tidak ada order menunggu. Kerja bagus! ✨
          </div>
        ) : (
          <div className="space-y-3">
            {toProcess.slice(0, 8).map((o) => (
              <QueueRow key={o.id} order={o} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function QueueRow({ order }: { order: OrderRow }) {
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/admin/orders/${order.order_code}`} className="font-mono text-xs text-slate-500 hover:underline">
          {order.order_code}
        </Link>
        <div className="flex gap-2">
          <PaymentStatusBadge status={order.payment_status} />
          <OrderStatusBadge status={order.order_status} />
        </div>
      </div>
      <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        <p>
          <span className="text-slate-500">Produk:</span> {order.product_name_snapshot}{" "}
          <span className="text-slate-400">× {order.quantity}</span>
        </p>
        <p>
          <span className="text-slate-500">Buyer:</span>{" "}
          <strong>{order.buyer_name_snapshot || "-"}</strong>{" "}
          <span className="text-slate-400">(+{order.buyer_whatsapp_snapshot})</span>
        </p>
        <p className="font-bold text-brand-700">{formatRupiah(order.total_amount)}</p>
        <p className="text-xs text-slate-400">{formatDateTimeId(order.created_at)}</p>
      </div>
      <div className="mt-3 border-t border-slate-100 pt-3">
        <OrderActions order={order} back="/admin" />
      </div>
    </div>
  );
}
