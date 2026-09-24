import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/authz";
import { getOrderByCodeForBuyer } from "@/lib/orders";
import { ORDER_CODE_REGEX } from "@/lib/order-code";
import { formatRupiah } from "@/lib/money";
import { formatDateTimeId } from "@/lib/dates";
import { ReceiptActions } from "@/components/ReceiptActions";

export const metadata: Metadata = { title: "Struk Pembelian" };
export const dynamic = "force-dynamic";

const siteName = process.env.NEXT_PUBLIC_SITE_NAME ?? "Toko Saya";

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PAID: "LUNAS",
  PENDING: "MENUNGGU PEMBAYARAN",
  EXPIRED: "KADALUARSA",
  FAILED: "GAGAL",
};

interface Props {
  params: Promise<{ code: string }>;
}

export default async function OrderReceiptPage({ params }: Props) {
  const { code } = await params;
  const orderCode = decodeURIComponent(code).toUpperCase();
  if (!ORDER_CODE_REGEX.test(orderCode)) notFound();

  const ctx = await getAuthContext();
  if (!ctx) redirect(`/auth/login?next=${encodeURIComponent(`/orders/${orderCode}/receipt`)}`);

  const order = await getOrderByCodeForBuyer(orderCode, ctx.user.id);
  if (!order) notFound();

  const total =
    order.charged_amount && order.charged_amount > 0 ? order.charged_amount : order.total_amount;
  const statusLabel = PAYMENT_STATUS_LABEL[order.payment_status] ?? order.payment_status;
  const printedAt = formatDateTimeId(new Date().toISOString());

  return (
    <>
      {/* Halaman standalone: sembunyikan header/footer layout utama, dan bersihkan tampilan saat print. */}
      <style>{`
        body > header.masthead, body > footer.site-footer { display: none !important; }
        body, .newspaper-main { background: #fff !important; }
        .receipt-sheet { max-width: 420px; margin: 0 auto; background: #fff; }
        .receipt-rule { border-top: 2px dotted #94a3b8; }
        @media print {
          @page { margin: 12mm; }
          .no-print { display: none !important; }
          html, body, .newspaper-main { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .receipt-sheet { max-width: none; box-shadow: none !important; border: 0 !important; }
          a { text-decoration: none; color: inherit; }
        }
      `}</style>

      <div className="container-x mx-auto max-w-md space-y-4">
        <ReceiptActions backHref={`/orders/${order.order_code}`} />

        <article className="receipt-sheet border border-slate-300 p-6 font-mono text-sm text-slate-900">
          {/* Header koran */}
          <header className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center border-2 border-slate-900 font-serif text-xl font-black">
              AN
            </div>
            <h1 className="mt-2 font-serif text-2xl font-black uppercase tracking-wide">{siteName}</h1>
            <p className="text-xs italic text-slate-500">Kabar Belanja Hari Ini</p>
          </header>

          <div className="receipt-rule my-4" />

          <h2 className="text-center text-base font-bold tracking-[0.3em]">STRUK PEMBELIAN</h2>
          <p className="mt-1 text-center text-xs text-slate-600">#{order.order_code}</p>
          <p className="text-center text-xs text-slate-500">{formatDateTimeId(order.created_at)}</p>

          <div className="receipt-rule my-4" />

          {/* Tabel detail */}
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-dotted border-slate-400 text-left">
                <th className="py-1 font-bold">Produk</th>
                <th className="py-1 text-right font-bold">Qty</th>
                <th className="py-1 text-right font-bold">Harga Satuan</th>
                <th className="py-1 text-right font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-2 pr-2 align-top">{order.product_name_snapshot}</td>
                <td className="py-2 text-right align-top">{order.quantity}</td>
                <td className="py-2 text-right align-top whitespace-nowrap">
                  {formatRupiah(order.unit_price_snapshot)}
                </td>
                <td className="py-2 text-right align-top whitespace-nowrap">
                  {formatRupiah(order.unit_price_snapshot * order.quantity)}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-900">
                <td colSpan={3} className="py-2 text-right font-bold uppercase">
                  Total Dibayar
                </td>
                <td className="py-2 text-right text-sm font-black whitespace-nowrap">{formatRupiah(total)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="receipt-rule my-4" />

          {/* Info pembeli */}
          <dl className="space-y-1 text-xs">
            <Row label="Nama" value={order.buyer_name_snapshot} />
            <Row label="WhatsApp" value={`+${order.buyer_whatsapp_snapshot}`} />
          </dl>

          <div className="receipt-rule my-4" />

          {/* Status pembayaran */}
          <dl className="space-y-1 text-xs">
            <Row label="Status" value={statusLabel} strong />
            {order.paid_at && <Row label="Lunas pada" value={formatDateTimeId(order.paid_at)} />}
          </dl>

          <div className="receipt-rule my-4" />

          <footer className="text-center text-xs text-slate-600">
            <p className="font-serif italic">Terima kasih telah berbelanja di {siteName}</p>
            <p className="mt-1 text-[10px] text-slate-400">Dicetak: {printedAt}</p>
          </footer>
        </article>
      </div>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right ${strong ? "font-black" : "font-medium"}`}>{value}</dd>
    </div>
  );
}
