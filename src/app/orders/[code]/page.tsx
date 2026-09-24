import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/authz";
import { getOrderByCodeForBuyer } from "@/lib/orders";
import { ORDER_CODE_REGEX } from "@/lib/order-code";
import { formatRupiah } from "@/lib/money";
import { formatDateTimeId } from "@/lib/dates";
import { OrderTimeline } from "@/components/OrderTimeline";
import { PaymentMethodBadge, PaymentStatusBadge } from "@/components/StatusBadge";

export const metadata: Metadata = { title: "Detail Pesanan" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ code: string }>;
}

export default async function OrderDetailPage({ params }: Props) {
  const { code } = await params;
  const orderCode = decodeURIComponent(code).toUpperCase();
  if (!ORDER_CODE_REGEX.test(orderCode)) notFound();

  const ctx = await getAuthContext();
  if (!ctx) redirect(`/auth/login?next=${encodeURIComponent(`/orders/${orderCode}`)}`);

  const order = await getOrderByCodeForBuyer(orderCode, ctx.user.id);
  if (!order) notFound();

  return (
    <div className="container-x mx-auto max-w-2xl space-y-4">
      <Link href="/orders" className="paper-link text-sm font-semibold">
        ← Semua pesanan
      </Link>

      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dotted border-slate-300 pb-3">
          <div>
            <p className="section-kicker">Arsip pesanan</p>
            <h1 className="mt-1 font-mono text-sm font-bold text-slate-500">#{order.order_code}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <PaymentMethodBadge method={order.payment_method} />
            <PaymentStatusBadge status={order.payment_status} />
          </div>
        </div>
        <div className="paper-inset mt-4 p-4 text-sm">
          <DetailRow label="Produk" value={`${order.product_name_snapshot} × ${order.quantity}`} />
          <DetailRow label="Harga satuan" value={formatRupiah(order.unit_price_snapshot)} />
          <DetailRow
            label="Total"
            value={formatRupiah(order.charged_amount && order.charged_amount > 0 ? order.charged_amount : order.total_amount)}
            strong
          />
          <DetailRow label="Dibuat" value={formatDateTimeId(order.created_at)} />
          <DetailRow label="WhatsApp tujuan" value={`+${order.buyer_whatsapp_snapshot}`} />
          {order.paid_at && <DetailRow label="Lunas pukul" value={formatDateTimeId(order.paid_at)} />}
        </div>

        {order.payment_status === "PENDING" &&
          (order.payment_method === "MANUAL" && order.manual_claim_at ? (
            <div className="alert-info mt-3">
              <span className="font-bold">🧾 Menunggu verifikasi penjual.</span>{" "}
              Kamu sudah melaporkan transfer. Penjual sedang mencocokkan mutasi
              transfer — status halaman ini berubah otomatis setelah diverifikasi.
            </div>
          ) : (
            <div className="alert-warn mt-3 flex items-center justify-between gap-2">
              <span>Belum ada pembayaran terverifikasi.</span>
              <Link href={`/pay/${order.order_code}`} className="btn-primary btn-sm shrink-0">
                {order.payment_method === "MANUAL" ? "Lanjut Bayar via WhatsApp →" : "Buka Halaman Pembayaran →"}
              </Link>
            </div>
          ))}
        {order.payment_method === "MANUAL" &&
          order.manual_review_status === "REJECTED" &&
          order.payment_status === "PENDING" && (
            <p className="alert-error mt-3">
              Konfirmasi transfermu ditolak penjual
              {order.manual_review_note ? `: ${order.manual_review_note}` : ""}. Periksa nominal &
              tujuan transfer, lalu konfirmasi ulang di halaman pembayaran.
            </p>
          )}
        {order.payment_status === "EXPIRED" && (
          <p className="alert-error mt-3">Pembayaran kadaluarsa. Buat order ulang bila masih berminat.</p>
        )}
        {order.order_status === "PROCESSING" && (
          <p className="alert-info mt-3">
            Penjual sedang menyiapkan pesananmu. Tunggu pesan di WhatsApp{" "}
            <strong>+{order.buyer_whatsapp_snapshot}</strong>.
          </p>
        )}
        {order.order_status === "DONE" && (
          <p className="alert-info mt-3">Pesanan selesai. Terima kasih sudah belanja! 🎉</p>
        )}
        {order.payment_status === "PAID" && (
          <div className="mt-4 border-t border-dotted border-slate-300 pt-4">
            <Link href={`/orders/${order.order_code}/receipt`} className="btn-secondary btn-sm">
              🧾 Download Struk
            </Link>
          </div>
        )}
      </div>

      <OrderTimeline order={order} />
    </div>
  );
}

function DetailRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dotted border-slate-300 py-2 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? "font-serif font-black text-brand-700" : "font-medium text-slate-800"}>{value}</span>
    </div>
  );
}
