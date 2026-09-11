import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/authz";
import { getOrderByCodeForBuyer } from "@/lib/orders";
import { ORDER_CODE_REGEX } from "@/lib/order-code";
import { formatRupiah } from "@/lib/money";
import { formatDateTimeId } from "@/lib/dates";
import { OrderTimeline } from "@/components/OrderTimeline";
import { PaymentStatusBadge } from "@/components/StatusBadge";

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
      <Link href="/orders" className="text-sm text-slate-500 hover:underline">
        ← Semua pesanan
      </Link>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-mono text-sm text-slate-500">#{order.order_code}</h1>
          <PaymentStatusBadge status={order.payment_status} />
        </div>
        <div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm">
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

        {order.payment_status === "PENDING" && (
          <div className="alert-warn mt-3 flex items-center justify-between gap-2">
            <span>Belum ada pembayaran terverifikasi.</span>
            <Link href={`/pay/${order.order_code}`} className="btn-primary btn-sm shrink-0">
              Bayar QRIS
            </Link>
          </div>
        )}
        {order.payment_status === "EXPIRED" && (
          <p className="alert-error mt-3">
            Pembayaran kadaluarsa. Buat order ulang bila masih berminat.
          </p>
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
      </div>

      <OrderTimeline order={order} />
    </div>
  );
}

function DetailRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? "font-bold" : "font-medium"}>{value}</span>
    </div>
  );
}
