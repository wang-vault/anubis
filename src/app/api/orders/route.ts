import type { NextRequest } from "next/server";
import { ErrorCodes, handleApi, HttpError, ok } from "@/lib/api";
import { requireUser, requireVerifiedUser } from "@/lib/authz";
import { checkoutSchema } from "@/lib/validation";
import { createOrderForBuyer, listOrdersForBuyer } from "@/lib/orders";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders
 * Body: { productId, quantity }
 *
 * Alur (sesuai requirement §8/§10): validasi session → email verified →
 * ambil produk & harga dari DB store → hitung total server-side → insert
 * order PENDING → create payment YoBasePay → simpan payment ref.
 * Data yang dipakai untuk harga TIDAK PERNAH berasal dari body client.
 */
export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const ctx = await requireVerifiedUser();

    // Batas lunak (best-effort, per instance): anti spam pembuatan order.
    const rl = rateLimit(`order:${ctx.user.id}`, 10, 10 * 60_000);
    if (!rl.ok) {
      throw new HttpError(
        429,
        ErrorCodes.tooManyRequests,
        `Terlalu banyak percobaan. Coba lagi dalam ${rl.retryAfterSec} detik.`,
      );
    }

    const body = checkoutSchema.parse(await request.json());
    const { order, payment } = await createOrderForBuyer(ctx, body);
    return {
      order: {
        order_code: order.order_code,
        total_amount: order.total_amount,
        order_status: order.order_status,
        payment_status: order.payment_status,
      },
      payment,
    };
  }, (data) => ok(data, 201));
}

/** GET /api/orders — daftar order milik user login (query difilter account_id). */
export async function GET() {
  return handleApi(async () => {
    const ctx = await requireUser();
    const orders = await listOrdersForBuyer(ctx.user.id);
    return {
      orders: orders.map((o) => ({
        order_code: o.order_code,
        product_name: o.product_name_snapshot,
        quantity: o.quantity,
        total_amount: o.total_amount,
        charged_amount: o.charged_amount ?? null,
        payment_status: o.payment_status,
        order_status: o.order_status,
        payment_method: o.payment_method,
        manual_claim_at: o.manual_claim_at,
        created_at: o.created_at,
      })),
    };
  }, (data) => ok(data));
}
