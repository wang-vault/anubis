import type { NextRequest } from "next/server";
import { ErrorCodes, handleApi, HttpError, ok } from "@/lib/api";
import { requireUser } from "@/lib/authz";
import { getOrderByCodeForBuyer } from "@/lib/orders";
import { orderCodeParamSchema } from "@/lib/validation";
import { toBuyerOrderPublic } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/orders/[code] — detail order milik buyer.
 * Kepemilikan ditegakkan di query (order_code + account_id sekaligus),
 * order milik orang lain → 404 (tidak membocorkan keberadaan order).
 * Field internal (payment_id, telegram_notified_at, account_id, …) disaring.
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
    return { order: toBuyerOrderPublic(order) };
  }, (data) => ok(data));
}
