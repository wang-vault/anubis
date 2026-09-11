import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthContext, isAdmin } from "@/lib/authz";
import { findOrderByCodeOrId, getOrderByCodeForBuyer } from "@/lib/orders";
import { getProduct } from "@/lib/products";
import { ORDER_CODE_REGEX } from "@/lib/order-code";
import { PaymentPanel } from "@/components/PaymentPanel";

export const metadata: Metadata = { title: "Pembayaran" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ code: string }>;
}

/**
 * Halaman pembayaran buyer. Data order dimuat server-side (ownership
 * check); panel status + QRIS + countdown di-render dan disinkronkan via
 * endpoint /api/payments/status (sumber kebenaran: server + provider,
 * BUKAN klaim browser).
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

  return (
    <PaymentPanel
      order={{
        order_code: order.order_code,
        product_name: order.product_name_snapshot,
        quantity: order.quantity,
        total_amount: order.total_amount,
        charged_amount: order.charged_amount ?? null,
        payment_status: order.payment_status,
        order_status: order.order_status,
        payment_url: order.payment_url,
        qr_image_url: order.qr_image_url,
        payment_expired_at: order.payment_expired_at,
      }}
      product={product}
    />
  );
}
