import type { NextRequest } from "next/server";
import { ErrorCodes, handleApi, HttpError, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { findOrderByCodeOrId } from "@/lib/orders";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/orders/[codeOrId] — detail satu order (order_code publik
 * atau UUID internal), hanya admin.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ codeOrId: string }> },
) {
  return handleApi(async () => {
    await requireAdmin();
    const { codeOrId } = await params;
    const order = await findOrderByCodeOrId(decodeURIComponent(codeOrId));
    if (!order) throw new HttpError(404, ErrorCodes.notFound, "Order tidak ditemukan.");
    return { order };
  }, (data) => ok(data));
}
