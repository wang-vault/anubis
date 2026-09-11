import type { Metadata } from "next";
import Link from "next/link";
import { listAdminOrders } from "@/lib/orders";
import { formatRupiah } from "@/lib/money";
import { formatDateTimeId } from "@/lib/dates";
import { OrderStatusBadge, PaymentMethodBadge, PaymentStatusBadge } from "@/components/StatusBadge";
import { OrderActions } from "@/components/admin/OrderActions";
import type { OrderStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Order — Admin" };

const TABS: { key: string; label: string }[] = [
  { key: "", label: "Semua" },
  { key: "CLAIM", label: "Verifikasi Manual" },
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
  // "CLAIM" = antrian pembayaran manual yang menunggu verifikasi penjual.
  const manualClaim = status === "CLAIM";
  const orders = await listAdminOrders({
    status: manualClaim ? undefined : ((status || undefined) as OrderStatus | undefined),
    q: sp.q,
    manualClaim,
  });
  const backParams = new URLSearchParams();
  if (status) backParams.set("status", status);
  if (sp.q) backParams.set("q", sp.q);
  const back = `/admin/orders${backParams.toString() ? `?${backParams.toString()}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="paper-heading flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-kicker">Kantor redaksi · Arsip</p>
          <h1 className="paper-heading-title">Order masuk</h1>
          <p className="mt-2 text-sm text-slate-500">Maks. 200 order terbaru — gunakan filter untuk yang lama.</p>
        </div>
        <form className="flex w-full gap-2 sm:w-auto" action="/admin/orders" method="get">
          {status && <input type="hidden" name="status" value={status} />}
          <label className="sr-only" htmlFor="order-search">Cari order</label>
          <input
            id="order-search"
            className="input min-w-0 flex-1 sm:w-56"
            name="q"
            placeholder="Kode / buyer / produk"
            defaultValue={sp.q ?? ""}
          />
          <button className="btn-secondary shrink-0" type="submit">
            Cari
          </button>
        </form>
      </div>

      {sp.error && <p className="alert-error">{String(sp.error).slice(0, 200)}</p>}

      <div className="flex flex-wrap items-center gap-1.5">
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
        {sp.q && (
          <Link href={status ? `/admin/orders?status=${status}` : "/admin/orders"} className="paper-link ml-1 text-xs font-bold">
            Hapus pencarian
          </Link>
        )}
      </div>

      {orders.length === 0 ? (
        <div className="paper-empty p-10 text-center text-sm text-slate-500">
          Tidak ada order untuk filter ini.
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dotted border-slate-300 pb-2">
                <Link href={`/admin/orders/${o.order_code}`} className="paper-link font-mono text-xs font-bold">
                  {o.order_code}
                </Link>
                <div className="flex flex-wrap gap-2">
                  <PaymentMethodBadge method={o.payment_method} />
                  <PaymentStatusBadge status={o.payment_status} />
                  <OrderStatusBadge status={o.order_status} />
                </div>
              </div>
              <div className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
                <p>
                  {o.product_name_snapshot} <span className="text-slate-400">× {o.quantity}</span> —{" "}
                  <strong className="font-serif text-brand-700">{formatRupiah(o.total_amount)}</strong>
                </p>
                <p className="sm:text-right">
                  <span className="text-slate-500">Buyer:</span> {o.buyer_name_snapshot || "-"}{" "}
                  <span className="text-slate-400">(+{o.buyer_whatsapp_snapshot || "-"})</span>
                </p>
                <p className="text-xs text-slate-400 sm:col-span-2">
                  {o.payment_method === "MANUAL" && o.manual_claim_at && (
                    <span className="font-bold text-amber-700">
                      🧾 klaim transfer {formatDateTimeId(o.manual_claim_at)} ·{" "}
                    </span>
                  )}
                  {formatDateTimeId(o.created_at)}
                  {o.paid_at && <> · lunas {formatDateTimeId(o.paid_at)}</>}
                  {o.telegram_notified_at && <> · 🔔 dinotifikasi {formatDateTimeId(o.telegram_notified_at)}</>}
                </p>
              </div>
              <div className="mt-3 border-t border-dotted border-slate-300 pt-3">
                <OrderActions order={o} back={back} compact />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
