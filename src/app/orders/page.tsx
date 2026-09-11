import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/authz";
import { listOrdersForBuyer } from "@/lib/orders";
import { formatRupiah } from "@/lib/money";
import { formatDateTimeId } from "@/lib/dates";
import { OrderStatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/UiBits";

export const metadata: Metadata = { title: "Pesanan Saya" };
export const dynamic = "force-dynamic";

export default async function MyOrdersPage() {
  const ctx = await requireUser();
  const orders = await listOrdersForBuyer(ctx.user.id);

  return (
    <div className="container-x mx-auto max-w-2xl">
      <div className="paper-heading">
        <p className="section-kicker">Arsip pribadi · Pelanggan</p>
        <h1 className="paper-heading-title">Pesanan saya</h1>
        <p className="mt-2 text-sm text-slate-500">
          Status mengikuti data terbaru. Muat ulang halaman untuk menyegarkan kabar pesanan.
        </p>
      </div>
      <div className="mt-5 space-y-3">
        {orders.length === 0 ? (
          <EmptyState
            icon="0"
            title="Belum ada pesanan"
            desc="Pesanan yang kamu buat akan muncul di sini."
            action={
              <Link href="/products" className="btn-primary">
                Mulai Belanja →
              </Link>
            }
          />
        ) : (
          orders.map((o) => (
            <Link
              key={o.id}
              href={`/orders/${o.order_code}`}
              className="card block p-4 transition hover:-translate-y-0.5 sm:p-5"
              aria-label={`Lihat detail pesanan ${o.order_code}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dotted border-slate-300 pb-2">
                <span className="font-mono text-xs font-bold tracking-wide text-slate-500">{o.order_code}</span>
                <OrderStatusBadge status={o.order_status} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-serif text-base font-black">
                    {o.product_name_snapshot} <span className="text-slate-400">× {o.quantity}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{formatDateTimeId(o.created_at)}</p>
                </div>
                <p className="shrink-0 font-serif text-base font-black text-brand-700">{formatRupiah(o.total_amount)}</p>
              </div>
              {o.payment_status === "PENDING" && (
                <p className="alert-warn mt-3 text-xs font-semibold">
                  Menunggu pembayaran — buka detail untuk bayar QRIS.
                </p>
              )}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
