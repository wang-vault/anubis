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
      <div className="paper-heading">
        <p className="section-kicker">Kantor redaksi · Ringkasan</p>
        <h1 className="paper-heading-title">Dashboard penjual</h1>
        <p className="mt-2 text-sm text-slate-500">Pantau berita pembayaran dan siapkan pesanan yang sudah lunas.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Order hari ini" value={stats.ordersToday} />
        <StatCard label="Perlu diproses" value={stats.needProcessing} accent="text-emerald-700" />
        <StatCard label="Sedang diproses" value={stats.processing} accent="text-sky-700" />
        <StatCard label="Belum lunas" value={stats.pendingPayment} accent="text-amber-700" />
        <StatCard label="Selesai hari ini" value={stats.doneToday} />
        <StatCard label="Revenue bulan ini" value={formatRupiah(stats.revenueMonth)} accent="text-brand-700" />
      </div>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="section-kicker">Antrian utama</p>
            <h2 className="admin-section-title">Perlu diproses (lunas)</h2>
          </div>
          <Link href="/admin/orders?status=PAID" className="section-link">
            Lihat semua →
          </Link>
        </div>
        {toProcess.length === 0 ? (
          <div className="paper-empty p-8 text-center text-sm text-slate-500">
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
    <div className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dotted border-slate-300 pb-2">
        <Link href={`/admin/orders/${order.order_code}`} className="paper-link font-mono text-xs font-bold">
          {order.order_code}
        </Link>
        <div className="flex flex-wrap gap-2">
          <PaymentStatusBadge status={order.payment_status} />
          <OrderStatusBadge status={order.order_status} />
        </div>
      </div>
      <div className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
        <p>
          <span className="text-slate-500">Produk:</span> {order.product_name_snapshot}{" "}
          <span className="text-slate-400">× {order.quantity}</span>
        </p>
        <p>
          <span className="text-slate-500">Buyer:</span>{" "}
          <strong>{order.buyer_name_snapshot || "-"}</strong>{" "}
          <span className="text-slate-400">(+{order.buyer_whatsapp_snapshot})</span>
        </p>
        <p className="font-serif font-black text-brand-700">{formatRupiah(order.total_amount)}</p>
        <p className="text-xs text-slate-400">{formatDateTimeId(order.created_at)}</p>
      </div>
      <div className="mt-3 border-t border-dotted border-slate-300 pt-3">
        <OrderActions order={order} back="/admin" />
      </div>
    </div>
  );
}
