import "server-only";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { storeDb } from "@/lib/supabase/server";
import { ErrorCodes, HttpError } from "@/lib/api";
import { log } from "@/lib/logger";
import type { ProductRow } from "@/lib/types";

/**
 * Akses katalog produk.
 *
 * - Baca: hasil di-cache 60 detik (unstable_cache + tag "products") → ringan
 *   di serverless, tetap segar maksimal 1 menit.
 * - Perubahan admin (tambah/edit/nonaktifkan/hapus) memanggil revalidateTag →
 *   perubahan langsung terlihat, tanpa background process.
 * - Pembeli TIDAK pernah menulis ke tabel products; harga untuk order selalu
 *   dibaca ulang server-side (lihat orders.createOrderForBuyer).
 */

const listActiveProductsCached = unstable_cache(
  async (): Promise<ProductRow[]> => {
    const db = await storeDb();
    const { data, error } = await db
      .from("products")
      .select("id,name,description,price,image_url,is_active,created_at,updated_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      log.error("products_list_failed", { message: error.message });
      return [];
    }
    return (data ?? []) as ProductRow[];
  },
  ["products-active"],
  { tags: ["products"], revalidate: 60 },
);

const getProductCached = unstable_cache(
  async (id: string): Promise<ProductRow | null> => {
    const db = await storeDb();
    const { data } = await db
      .from("products")
      .select("id,name,description,price,image_url,is_active,created_at,updated_at")
      .eq("id", id)
      .maybeSingle<ProductRow>();
    return data;
  },
  ["product-one"],
  { tags: ["products"], revalidate: 60 },
);

export async function listActiveProducts(): Promise<ProductRow[]> {
  return listActiveProductsCached();
}

/** Boleh mengembalikan produk non-aktif; caller menampilkan "tidak tersedia". */
export async function getProduct(id: string): Promise<ProductRow | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return getProductCached(id);
}

export function productsCacheKey(id?: string): string[] {
  return id ? ["product-one", id] : ["products-active"];
}

// ---------------------------------------------------------------------------
// ADMIN MUTATIONS (dipanggil oleh API route & server action — logic sama)
// ---------------------------------------------------------------------------

export interface ProductInput {
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  is_active: boolean;
}

async function bumpCaches(id: string) {
  revalidateTag("products");
  revalidatePath("/");
  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
}

export async function adminCreateProduct(input: ProductInput): Promise<ProductRow> {
  const db = await storeDb();
  const { data, error } = await db
    .from("products")
    .insert({
      name: input.name,
      description: input.description,
      price: input.price,
      image_url: input.image_url,
      is_active: input.is_active,
    })
    .select("id,name,description,price,image_url,is_active,created_at,updated_at")
    .single<ProductRow>();
  if (error || !data) {
    log.error("product_create_failed", { message: error?.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal menyimpan produk.");
  }
  revalidateTag("products");
  revalidatePath("/");
  revalidatePath("/products");
  log.info("product_created", { id: data.id, name: data.name });
  return data;
}

export async function adminUpdateProduct(
  id: string,
  patch: Partial<ProductInput>,
): Promise<ProductRow> {
  const db = await storeDb();
  const { data, error } = await db
    .from("products")
    .update(patch)
    .eq("id", id)
    .select("id,name,description,price,image_url,is_active,created_at,updated_at")
    .single<ProductRow>();
  if (error || !data) {
    log.error("product_update_failed", { id, message: error?.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal memperbarui produk.");
  }
  await bumpCaches(id);
  log.info("product_updated", { id, fields: Object.keys(patch) });
  return data;
}

export async function adminSetProductActive(id: string, isActive: boolean): Promise<ProductRow> {
  return adminUpdateProduct(id, { is_active: isActive });
}

/** Pesan 409 saat produk masih dipakai pesanan aktif. */
export const PRODUCT_DELETE_BLOCKED_MESSAGE =
  "Produk tidak bisa dihapus karena masih ada pesanan aktif.";

/**
 * Hapus produk dari katalog.
 * - 404 bila id tidak ada.
 * - 409 bila masih ada pesanan aktif (order_status bukan cancelled/refunded,
 *   tidak peka huruf). Skema saat ini (PENDING/PAID/PROCESSING/DONE/EXPIRED)
 *   tidak memuat kedua status itu, jadi pesanan apa pun yang masih mereferensi
 *   produk menghalangi penghapusan — selaras dengan FK `on delete restrict`.
 */
export async function adminDeleteProduct(id: string): Promise<void> {
  const db = await storeDb();

  const { data: existing, error: findError } = await db
    .from("products")
    .select("id")
    .eq("id", id)
    .maybeSingle<{ id: string }>();
  if (findError) {
    log.error("product_delete_lookup_failed", { id, message: findError.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal menghapus produk.");
  }
  if (!existing) {
    throw new HttpError(404, ErrorCodes.notFound, "Produk tidak ditemukan.");
  }

  const { count, error: orderError } = await db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("product_id", id)
    .not("order_status", "ilike", "cancelled")
    .not("order_status", "ilike", "refunded");
  if (orderError) {
    log.error("product_delete_order_check_failed", { id, message: orderError.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal menghapus produk.");
  }
  if ((count ?? 0) > 0) {
    throw new HttpError(409, ErrorCodes.conflict, PRODUCT_DELETE_BLOCKED_MESSAGE);
  }

  const { error: deleteError } = await db.from("products").delete().eq("id", id);
  if (deleteError) {
    log.error("product_delete_failed", {
      id,
      message: deleteError.message,
      code: deleteError.code,
    });
    // Balapan dengan order baru, atau FK restrict pada pesanan yang lolos filter.
    const code = deleteError.code ?? "";
    const message = deleteError.message ?? "";
    if (code === "23503" || message.includes("23503") || /foreign key/i.test(message)) {
      throw new HttpError(409, ErrorCodes.conflict, PRODUCT_DELETE_BLOCKED_MESSAGE);
    }
    throw new HttpError(500, ErrorCodes.internal, "Gagal menghapus produk.");
  }

  await bumpCaches(id);
  log.info("product_deleted", { id });
}

export async function adminListProducts(includeInactive = true): Promise<ProductRow[]> {
  const db = await storeDb();
  let query = db
    .from("products")
    .select("id,name,description,price,image_url,is_active,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) {
    log.error("admin_products_failed", { message: error.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal memuat produk.");
  }
  return (data ?? []) as ProductRow[];
}
