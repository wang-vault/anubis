import "server-only";
import { unstable_cache } from "next/cache";
import { storeDb } from "@/lib/supabase/server";
import { log } from "@/lib/logger";

/**
 * TESTIMONI OTOMATIS — halaman publik /testimoni.
 *
 * Sumber data: pesanan dengan order_status = 'DONE' (ditandai selesai oleh
 * penjual dari dashboard). Maksimal TESTIMONIAL_LIMIT pesanan terbaru.
 *
 * Privasi (halaman ini bisa dibaca SIAPA PUN, tamu sekali pun):
 *  - Query HANYA memilih kolom non-sensitif: nama snapshot, nama produk,
 *    jumlah, dan waktu. Kolom seperti nomor WhatsApp, email, order_code,
 *    dan nominal TIDAK PERNAH di-select — bukan sekadar disembunyikan di UI.
 *  - Nama pembeli dipendekkan (maskBuyerName) sebelum ditampilkan.
 *  - Akses tetap lewat service role server-side (tabel orders RLS deny-all),
 *    sama seperti seluruh akses toko di aplikasi ini.
 */

/** Maksimal pesanan selesai yang ditampilkan sebagai testimoni. */
export const TESTIMONIAL_LIMIT = 20;

/** Tag cache — direvalidasi saat penjual mengubah status order. */
export const TESTIMONIALS_CACHE_TAG = "testimonials";

/** Satu kartu testimoni (sudah aman untuk publik). */
export interface TestimonialItem {
  /** Nama pembeli SUDAH dipendekkan (mis. "Budi S."). */
  name: string;
  productName: string;
  quantity: number;
  /** Waktu pesanan ditandai selesai (ISO). */
  completedAt: string;
}

/**
 * Pendekkan nama pembeli demi privasi:
 *   "Budi Santoso"      → "Budi S."
 *   "Budi Santoso Andi" → "Budi A."   (nama depan + inisial nama belakang)
 *   "Rizky"             → "R***y"     (satu kata: awal + *** + akhir)
 *   "" / null           → "Pembeli"
 */
export function maskBuyerName(raw: string | null | undefined): string {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) return "Pembeli";
  const parts = name.split(" ");
  if (parts.length === 1) {
    const s = parts[0]!;
    if (s.length <= 2) return `${s[0]}***`;
    return `${s[0]}***${s[s.length - 1]}`;
  }
  const first = parts[0]!;
  const lastInitial = parts[parts.length - 1]![0] ?? "";
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

/** Kolom yang di-query — DELIBERATELY minimal (lihat catatan privasi di atas). */
const TESTIMONIAL_SELECT = "buyer_name_snapshot,product_name_snapshot,quantity,updated_at";

/** Antarmuka db minimal yang dibutuhkan (mudah di-fake untuk unit test). */
interface TestimonialsDb {
  from(table: "orders"): {
    select(cols: string): {
      eq(col: string, value: unknown): {
        order(col: string, opts: { ascending: boolean }): {
          limit(n: number): PromiseLike<{
            data:
              | {
                  buyer_name_snapshot: string;
                  product_name_snapshot: string;
                  quantity: number;
                  updated_at: string;
                }[]
              | null;
            error: { message: string; code?: string } | null;
          }>;
        };
      };
    };
  };
}

/**
 * Query inti (TANPA cache) — dipisah dari wrapper unstable_cache supaya bisa
 * di-unit-test langsung memakai fake Supabase (test/helpers/fake-store.ts).
 * Kegagalan query TIDAK melempar: halaman publik menampilkan daftar kosong,
 * bukan 500 (pola yang sama dengan products_list_failed).
 */
export async function fetchDoneOrderTestimonials(db: TestimonialsDb): Promise<TestimonialItem[]> {
  const { data, error } = await db
    .from("orders")
    .select(TESTIMONIAL_SELECT)
    .eq("order_status", "DONE")
    .order("updated_at", { ascending: false })
    .limit(TESTIMONIAL_LIMIT);

  if (error) {
    log.warn("testimonials_list_failed", { message: error.message, code: error.code ?? null });
    return [];
  }
  return (data ?? []).map((row) => ({
    name: maskBuyerName(row.buyer_name_snapshot),
    productName: row.product_name_snapshot,
    quantity: Number(row.quantity) || 1,
    completedAt: row.updated_at,
  }));
}

const listCached = unstable_cache(
  async (): Promise<TestimonialItem[]> => fetchDoneOrderTestimonials((await storeDb()) as unknown as TestimonialsDb),
  ["testimonials-done"],
  { tags: [TESTIMONIALS_CACHE_TAG], revalidate: 60 },
);

/**
 * Daftar testimoni untuk halaman publik. Cache 60 detik (pola yang sama dengan
 * katalog); revalidateTag(TESTIMONIALS_CACHE_TAG) dipanggil saat penjual
 * menandai pesanan selesai → testimoni baru langsung muncul.
 */
export async function listCompletedTestimonials(): Promise<TestimonialItem[]> {
  return listCached();
}

/** Ekspos daftar kolom untuk unit test (jaga agar tetap minimal). */
export const TESTIMONIAL_SELECT_COLUMNS = TESTIMONIAL_SELECT;
