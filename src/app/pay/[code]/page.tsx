import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthContext, isAdmin } from "@/lib/authz";
import { findOrderByCodeOrId, getOrderByCodeForBuyer } from "@/lib/orders";
import { getProduct } from "@/lib/products";
import { getManualPaymentView } from "@/lib/payment-config";
import { ORDER_CODE_REGEX } from "@/lib/order-code";
import { PaymentPanel, type PaymentPanelProps } from "@/components/PaymentPanel";
import { paymentWhatsappUrl, transferProofMessage } from "@/lib/whatsapp";
import { waMeUrl } from "@/lib/phone";

export const metadata: Metadata = { title: "Pembayaran" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ code: string }>;
}

/**
 * Halaman pembayaran buyer.
 *
 * Semua koordinasi pembayaran terjadi di WhatsApp: halaman ini menyiapkan
 * tautan chat yang sudah terisi kode order + nominal, menampilkan sisa waktu
 * bayar, dan memantau status order (sumber kebenaran tetap server).
 * Detail pembayaran (QRIS statis / rekening / e-wallet) dikirim penjual di
 * chat, jadi nomor/QR tidak pernah disimpan di halaman ini.
 */
export default async function PayPage({ params }: Props) {
  const { code } = await params;
  const orderCode = decodeURIComponent(code).toUpperCase();
  if (!ORDER_CODE_REGEX.test(orderCode)) notFound();

  const ctx = await getAuthContext();
  if (!ctx) redirect(`/auth/login?next=${encodeURIComponent(`/pay/${orderCode}`)}`);

  let order = await getOrderByCodeForBuyer(orderCode, ctx.user.id);
  if (!order && isAdmin(ctx)) order = await findOrderByCodeOrId(orderCode);
  if (!order) notFound();

  const product = await getProduct(order.product_id);

  let manual: PaymentPanelProps["manual"] = null;
  // Konfigurasi pembayaran manual dibaca untuk SEMUA order yang belum lunas
  // (termasuk order arsip dari masa QRIS otomatis): layar "kadaluarsa/gagal"
  // menyuruh buyer menghubungi penjual, jadi tautan WhatsApp-nya harus ada.
  if (order.payment_status !== "PAID") {
    const m = await getManualPaymentView();
    const amount = order.charged_amount ?? order.total_amount;
    const messageVars = {
      storeName: process.env.NEXT_PUBLIC_SITE_NAME ?? "Toko Saya",
      buyerName: order.buyer_name_snapshot,
      orderCode: order.order_code,
      productName: order.product_name_snapshot,
      quantity: order.quantity,
      amount,
    };
    const waHref = m.whatsappNumber
      ? paymentWhatsappUrl(m.whatsappNumber, messageVars, m.messageTemplate)
      : null;
    const proofHref = m.whatsappNumber
      ? waMeUrl(
          m.whatsappNumber,
          transferProofMessage({
            orderCode: order.order_code,
            amount,
            buyerName: order.buyer_name_snapshot,
          }),
        )
      : null;

    manual = {
      label: m.label,
      sellerName: m.sellerName,
      instructions: m.instructions,
      whatsappDisplay: m.whatsappDisplay,
      waHref,
      proofHref,
    };
  }

  return (
    <PaymentPanel
      manual={manual}
      order={{
        order_code: order.order_code,
        product_name: order.product_name_snapshot,
        quantity: order.quantity,
        total_amount: order.total_amount,
        charged_amount: order.charged_amount ?? null,
        payment_status: order.payment_status,
        order_status: order.order_status,
        payment_method: order.payment_method,
        payment_expired_at: order.payment_expired_at,
        manual_claim_at: order.manual_claim_at,
        manual_review_status: order.manual_review_status,
        manual_review_note: order.manual_review_note,
      }}
      product={product}
    />
  );
}
