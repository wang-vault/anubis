import type { NextRequest } from "next/server";
import { ErrorCodes, handleApi, HttpError, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { adminDeleteProduct, adminUpdateProduct } from "@/lib/products";
import { productPatchSchema } from "@/lib/validation";
import { uuidSchema } from "@/lib/zod-helpers";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/products/[id] — edit produk / nonaktifkan (is_active=false).
 * Hanya admin (role divalidasi server-side).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(async () => {
    await requireAdmin();
    const { id } = await params;
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
      throw new HttpError(400, ErrorCodes.validation, "ID produk tidak valid.");
    }
    const patch = productPatchSchema.parse(await request.json());
    const product = await adminUpdateProduct(id, {
      ...patch,
      // image_url sudah ternormalisasi ke string https | null oleh schema
      image_url: patch.image_url === undefined ? undefined : patch.image_url,
    });
    return { product };
  }, (data) => ok(data));
}

/**
 * DELETE /api/admin/products/[id] — hapus produk.
 * 404 bila tidak ada. 409 bila masih ada pesanan aktif
 * (order_status bukan cancelled/refunded).
 * Hanya admin (role divalidasi server-side). Logika PATCH di atas tidak disentuh.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(async () => {
    await requireAdmin();
    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      throw new HttpError(400, ErrorCodes.validation, "ID produk tidak valid.");
    }
    await adminDeleteProduct(id);
    return { deleted: true };
  }, (data) => ok(data));
}
