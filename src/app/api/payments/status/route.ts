import type { NextRequest } from "next/server";
import { ErrorCodes, handleApi, HttpError, ok } from "@/lib/api";
import { isAdmin, requireUser } from "@/lib/authz";
import { getOrderByCodeForBuyer, refreshOrderStatus, findOrderByCodeOrId } from "@/lib/orders";
import { orderCodeParamSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * GET /api/payments/status?order=ORD-...
 *
 * Status pembayaran dibaca dari database toko (sumber kebenaran server) dan
 * sekalian menjalankan pengecekan kadaluarsa. Browser TIDAK pernah bisa
 * menandai order lunas lewat endpoint ini — status PAID hanya lahir dari
 * verifikasi penjual di dashboard.
 *
 * Throttle: 30 req/menit per user (limiter route ini).
 */
export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const ctx = await requireUser();
    const code = request.nextUrl.searchParams.get("order");
    if (!code) throw new HttpError(400, ErrorCodes.validation, "Parameter `order` wajib diisi.");
    const orderCode = orderCodeParamSchema.parse(code.toUpperCase());

    const rl = rateLimit(`pstat:${ctx.user.id}`, 30, 60_000);
    if (!rl.ok) {
      throw new HttpError(
        429,
        ErrorCodes.tooManyRequests,
        `Terlalu sering mengecek. Coba lagi dalam ${rl.retryAfterSec} detik.`,
      );
    }

    // Kepemilikan: buyer → filter account_id; admin boleh cek order mana pun.
    let order = await getOrderByCodeForBuyer(orderCode, ctx.user.id);
    if (!order && isAdmin(ctx)) order = await findOrderByCodeOrId(orderCode);
    if (!order) throw new HttpError(404, ErrorCodes.notFound, "Order tidak ditemukan.");

    const { order: refreshed } = await refreshOrderStatus(order);
    return {
      order_code: refreshed.order_code,
      payment_status: refreshed.payment_status,
      order_status: refreshed.order_status,
      total_amount: refreshed.total_amount,
      charged_amount: refreshed.charged_amount ?? null,
      paid_at: refreshed.paid_at,
      payment_expired_at: refreshed.payment_expired_at,
      payment_method: refreshed.payment_method,
      manual_claim_at: refreshed.manual_claim_at,
      manual_review_status: refreshed.manual_review_status,
      manual_review_note: refreshed.manual_review_note,
      server_time: new Date().toISOString(),
    };
  }, (data) => ok(data));
}
