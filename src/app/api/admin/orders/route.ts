import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { listAdminOrders } from "@/lib/orders";
import type { OrderStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES = new Set<OrderStatus>(["PENDING", "PAID", "PROCESSING", "DONE", "EXPIRED"]);

/**
 * GET /api/admin/orders?status=PAID&q=ORD-...
 * Daftar order untuk dashboard penjual (hanya admin).
 */
export async function GET(request: NextRequest) {
  return handleApi(async () => {
    await requireAdmin();
    const statusParam = request.nextUrl.searchParams.get("status") ?? undefined;
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    const orders = await listAdminOrders({
      status: statusParam && STATUSES.has(statusParam as OrderStatus) ? (statusParam as OrderStatus) : undefined,
      q: q && q.length >= 3 ? q : undefined,
    });
    return { count: orders.length, orders };
  }, (data) => ok(data));
}
