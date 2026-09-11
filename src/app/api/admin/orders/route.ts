import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { listAdminOrders } from "@/lib/orders";
import type { OrderStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES = new Set<OrderStatus>(["PENDING", "PAID", "PROCESSING", "DONE", "EXPIRED"]);
/** Filter khusus: antrian pembayaran manual yang menunggu verifikasi penjual. */
const MANUAL_CLAIM_FILTER = "CLAIM";

/**
 * GET /api/admin/orders?status=PAID&q=ORD-...
 * GET /api/admin/orders?status=CLAIM  → klaim transfer manual menunggu verifikasi
 * Daftar order untuk dashboard penjual (hanya admin).
 */
export async function GET(request: NextRequest) {
  return handleApi(async () => {
    await requireAdmin();
    const statusParam = request.nextUrl.searchParams.get("status") ?? undefined;
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    const manualClaim = statusParam?.toUpperCase() === MANUAL_CLAIM_FILTER;
    const orders = await listAdminOrders({
      status:
        !manualClaim && statusParam && STATUSES.has(statusParam as OrderStatus)
          ? (statusParam as OrderStatus)
          : undefined,
      q: q && q.length >= 3 ? q : undefined,
      manualClaim,
    });
    return { count: orders.length, orders };
  }, (data) => ok(data));
}
