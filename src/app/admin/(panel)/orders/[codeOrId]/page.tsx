import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findOrderByCodeOrId, getProfileForAdmin } from "@/lib/orders";
import { formatRupiah } from "@/lib/money";
import { formatDateTimeId } from "@/lib/dates";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/StatusBadge";
import { OrderActions } from "@/components/admin/OrderActions";
import { OrderTimeline } from "@/components/OrderTimeline";
import { ManualVerificationForm } from "@/components/admin/ManualVerificationForm";
import { paymentMethodLabel } from "@/lib/payment-methods";

export const metadata: Metadata = { title: "Detail Order — Admin" };

interface Props {
  params: Promise<{ codeOrId: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function AdminOrderDetailPage({ params, searchParams }: Props) {
  const { codeOrId } = await params;
  const sp = await searchParams;
  const order = await findOrderByCodeOrId(decodeURIComponent(codeOrId));
  if (!order) notFound();
  const isManual = order.payment_method === "MANUAL";
  // Order lama dari masa QRIS otomatis tetap ditampilkan apa adanya — histori
  // transaksi tidak dimigrasikan, hanya dibaca (ditandai "arsip").
  const methodLabel = paymentMethodLabel(order.payment_method);

  const profile = await getProfileForAdmin(order.account_id);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/admin/orders" className="paper-link text-sm font-semibold">
        ← Daftar order
      </Link>

      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dotted border-slate-300 pb-3">
          <div>
            <p className="section-kicker">Kantor redaksi · Detail order</p>
            <h1 className="mt-1 font-mono text-base font-bold">{order.order_code}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <PaymentStatusBadge status={order.payment_status} />
            <OrderStatusBadge status={order.order_status} />
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className="paper-inset p-4 text-sm">
            <h2 className="paper-heading-kicker mb-2">Pesanan</h2>
            <KV k="Produk (snapshot)" v={`${order.product_name_snapshot} × ${order.quantity}`} />
            <KV k="Harga satuan" v={formatRupiah(order.unit_price_snapshot)} />
            <KV k="Total" v={formatRupiah(order.total_amount)} strong />
            <KV k="Dibuat" v={formatDateTimeId(order.created_at)} />
            <KV k="ID internal" v={<span className="break-all font-mono text-xs">{order.id}</span>} />
          </section>

          {sp.error && <p className="alert-error md:col-span-2">{String(sp.error).slice(0, 200)}</p>}

          <section className="paper-inset p-4 text-sm">
            <h2 className="paper-heading-kicker mb-2">Pembayaran</h2>
            <KV k="Metode" v={methodLabel} />
            {isManual ? (
              <>
                <KV k="Ditagihkan" v={formatRupiah(order.charged_amount ?? order.total_amount)} strong />
                <KV k="Klaim buyer" v={order.manual_claim_at ? formatDateTimeId(order.manual_claim_at) : "belum"} />
                {order.manual_claim_note && <KV k="Nama pengirim" v={order.manual_claim_note} />}
                {order.manual_claim_reference && <KV k="No. referensi" v={order.manual_claim_reference} />}
                <KV
                  k="Verifikasi penjual"
                  v={
                    order.manual_review_status
                      ? `${order.manual_review_status === "APPROVED" ? "✓ disetujui" : "✕ ditolak"} ${formatDateTimeId(order.manual_reviewed_at)}`
                      : "belum"
                  }
                />
              </>
            ) : (
              <KV k="Catatan" v="Order arsip QRIS otomatis (tidak dipakai lagi)" />
            )}
            {!isManual && (
              <KV k="ID transaksi (arsip)" v={<span className="break-all font-mono text-xs">{order.payment_id ?? "-"}</span>} />
            )}
            <KV k="Batas bayar" v={formatDateTimeId(order.payment_expired_at)} />
            <KV k="Lunas pukul" v={formatDateTimeId(order.paid_at)} />
            <KV k="Cek terakhir" v={formatDateTimeId(order.last_payment_checked_at)} />
            <KV
              k="Notifikasi Telegram"
              v={order.telegram_notified_at ? `✓ terkirim/dicoba ${formatDateTimeId(order.telegram_notified_at)}` : "belum"}
            />
          </section>

          {isManual && (
            <ManualVerificationForm order={order} back={`/admin/orders/${order.order_code}`} />
          )}

          <section className="paper-inset p-4 text-sm md:col-span-2">
            <h2 className="paper-heading-kicker mb-2">Buyer</h2>
            <KV k="Nama (snapshot)" v={order.buyer_name_snapshot || "-"} />
            <KV k="WhatsApp (snapshot)" v={`+${order.buyer_whatsapp_snapshot || "-"}`} />
            <KV k="Email (snapshot)" v={order.buyer_email_snapshot || "-"} />
            {profile && (
              <p className="hint mt-2">
                Kontak akun saat ini: {profile.name} · +{profile.whatsapp} · {profile.email}
                {profile.whatsapp !== order.buyer_whatsapp_snapshot && (
                  <span className="font-semibold text-amber-700">
                    {" "}⚠ buyer mengubah nomor WhatsApp setelah order dibuat.
                  </span>
                )}
              </p>
            )}
          </section>
        </div>

        <div className="mt-4 border-t border-dotted border-slate-300 pt-4">
          <OrderActions order={order} back={`/admin/orders/${order.order_code}`} />
        </div>
      </div>

      <OrderTimeline order={order} />
    </div>
  );
}

function KV({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-dotted border-slate-300 py-1.5 last:border-0">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span className={`text-right ${strong ? "font-bold text-brand-700" : "font-medium"}`}>{v}</span>
    </div>
  );
}
