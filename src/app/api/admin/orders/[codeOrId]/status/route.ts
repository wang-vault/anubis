import type { NextRequest } from "next/server";
import { ErrorCodes, handleApi, HttpError, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { adminOrderActionSchema } from "@/lib/validation";
import { adminTransition, findOrderByCodeOrId } from "@/lib/orders";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/orders/[codeOrId]/status
 * Body: { action: "process" | "complete" }
 *
 * Transisi yang diizinkan (state machine di lib/orders.ts):
 *   PAID → PROCESSING ("Proses Pesanan")
 *   PAID | PROCESSING → DONE ("Tandai Selesai")
 * Perubahan di luar daftar, atau balapan dengan webhook → 409.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ codeOrId: string }> },
) {
  return handleApi(async () => {
    const ctx = await requireAdmin();
    const { codeOrId } = await params;
    const order = await findOrderByCodeOrId(decodeURIComponent(codeOrId));
    if (!order) {
      throw new HttpError(404, ErrorCodes.notFound, "Order tidak ditemukan.");
    }
    const body = adminOrderActionSchema.parse(await request.json());
    const updated = await adminTransition(order.id, body.action, ctx);
    return {
      order: {
        order_code: updated.order_code,
        order_status: updated.order_status,
        payment_status: updated.payment_status,
      },
    };
  }, (data) => ok(data));
}
