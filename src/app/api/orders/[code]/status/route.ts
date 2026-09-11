import type { NextRequest } from "next/server";
import { ErrorCodes, handleApi, HttpError, ok } from "@/lib/api";
import { requireUser } from "@/lib/authz";
import { getOrderByCodeForBuyer } from "@/lib/orders";
import { orderCodeParamSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * GET /api/orders/[code]/status — polling RINGAN (hanya baca DB, tanpa
 * memanggil provider). Halaman pembayaran memakai endpoint ini tiap 8 detik;
 * sinkronisasi ke YoBasePay terpisah via /api/payments/status (throttled).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  return handleApi(async () => {
    const ctx = await requireUser();
    const { code } = await params;
    const orderCode = orderCodeParamSchema.parse(code.toUpperCase());
    const order = await getOrderByCodeForBuyer(orderCode, ctx.user.id);
    if (!order) {
      throw new HttpError(404, ErrorCodes.notFound, "Order tidak ditemukan.");
    }
    return {
      order_code: order.order_code,
      payment_status: order.payment_status,
      order_status: order.order_status,
      total_amount: order.total_amount,
      charged_amount: order.charged_amount ?? null,
      paid_at: order.paid_at,
      payment_expired_at: order.payment_expired_at,
      server_time: new Date().toISOString(),
    };
  }, (data) => ok(data));
}
