import type { Metadata } from "next";
import Link from "next/link";
import { listAdminOrders } from "@/lib/orders";
import { formatRupiah } from "@/lib/money";
import { formatDateTimeId } from "@/lib/dates";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/StatusBadge";
import { OrderActions } from "@/components/admin/OrderActions";
import type { OrderStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Order — Admin" };

const TABS: { key: string; label: string }[] = [
  { key: "", label: "Semua" },
  { key: "PENDING", label: "Belum Bayar" },
  { key: "PAID", label: "Perlu Diproses" },
  { key: "PROCESSING", label: "Diproses" },
  { key: "DONE", label: "Selesai" },
  { key: "EXPIRED", label: "Expired" },
];

interface Props {
  searchParams: Promise<{ status?: string; q?: string; error?: string }>;
}

export default async function AdminOrdersPage({ searchParams }: Props) {
  const sp = await searchParams;
  const status = TABS.some((t) => t.key === sp.status) ? sp.status : "";
  const orders = await listAdminOrders({
    status: (status || undefined) as OrderStatus | undefined,
    q: sp.q,
  });
  const back = `/admin/orders${status ? `?status=${status}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Order</h1>
          <p className="text-sm text-slate-500">Maks. 200 order terbaru — gunakan filter untuk yang lama.</p>
        </div>
        <form className="flex gap-2" action="/admin/orders" method="get">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            className="input w-56"
            name="q"
            placeholder="Cari kode / buyer / produk"
            defaultValue={sp.q ?? ""}
          />
          <button className="btn-secondary" type="submit">
            Cari
          </button>
        </form>
      </div>

      {sp.error && <p className="alert-error">{String(sp.error).slice(0, 200)}</p>}

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link
            key={t.key || "all"}
            href={t.key ? `/admin/orders?status=${t.key}` : "/admin/orders"}
            className={`badge ${
              (sp.status ?? "") === t.key
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {orders.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500">
          Tidak ada order untuk filter ini.
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/admin/orders/${o.order_code}`} className="font-mono text-xs text-slate-500 hover:underline">
                  {o.order_code}
                </Link>
                <div className="flex flex-wrap gap-2">
                  <PaymentStatusBadge status={o.payment_status} />
                  <OrderStatusBadge status={o.order_status} />
                </div>
              </div>
              <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                <p>
                  {o.product_name_snapshot} <span className="text-slate-400">× {o.quantity}</span> —{" "}
                  <strong>{formatRupiah(o.total_amount)}</strong>
                </p>
                <p className="sm:text-right">
                  <span className="text-slate-500">Buyer:</span> {o.buyer_name_snapshot || "-"}{" "}
                  <span className="text-slate-400">(+{o.buyer_whatsapp_snapshot || "-"})</span>
                </p>
                <p className="text-xs text-slate-400 sm:col-span-2">
                  {formatDateTimeId(o.created_at)}
                  {o.paid_at && <> · lunas {formatDateTimeId(o.paid_at)}</>}
                  {o.telegram_notified_at && <> · 🔔 dinotifikasi {formatDateTimeId(o.telegram_notified_at)}</>}
                </p>
              </div>
              <div className="mt-3 border-t border-slate-100 pt-3">
                <OrderActions order={o} back={back} compact />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
