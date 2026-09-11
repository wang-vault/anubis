import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { productInputSchema } from "@/lib/validation";
import { adminCreateProduct, adminListProducts } from "@/lib/products";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/products — daftar produk (termasuk non-aktif). Hanya admin (role DB).
 * POST /api/admin/products — buat produk baru.
 */
export async function GET() {
  return handleApi(async () => {
    await requireAdmin();
    const products = await adminListProducts();
    return { products };
  }, (data) => ok(data));
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    await requireAdmin();
    const input = productInputSchema.parse(await request.json());
    const product = await adminCreateProduct({
      name: input.name,
      description: input.description,
      price: input.price,
      image_url: input.image_url ?? null,
      is_active: input.is_active ?? true,
    });
    return { product };
  }, (data) => ok(data, 201));
}
