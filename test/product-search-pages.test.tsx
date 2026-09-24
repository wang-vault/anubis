/**
 * SMOKE TEST HALAMAN PENCARIAN PRODUK.
 *
 * Unit test lib memastikan mesin pencarinya benar; file ini memastikan
 * halaman yang memakainya benar-benar tersambung:
 *  - katalog publik `/products`: kotak cari, jumlah hasil, sorotan `<mark>`,
 *    empty state khusus pencarian, dan kata kunci yang selalu di-escape,
 *  - daftar produk penjual `/admin/products`: pencarian atas SEMUA produk
 *    (termasuk nonaktif) + empty state + hitungan hasil.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProductRow } from "@/lib/types";

const h = vi.hoisted(() => ({
  products: [] as ProductRow[],
}));

// Katalog & daftar admin datang dari lib produk (di app: cache + Supabase).
vi.mock("@/lib/products", () => ({
  listActiveProducts: async () => h.products,
  adminListProducts: async () => h.products,
}));

// Halaman admin memakai server action milik Next (butuh request context).
vi.mock("@/app/admin/actions", () => ({
  toggleProductAction: async () => {},
}));

// Tombol pending (useFormStatus) tidak relevan untuk uji markup.
vi.mock("@/components/ActionButton", () => ({
  ActionButton: ({ pendingText: _pendingText, ...props }: Record<string, unknown>) => (
    <button {...props} />
  ),
}));

import ProductsPage, { generateMetadata } from "@/app/products/page";
import AdminProductsPage from "@/app/admin/(panel)/products/page";

function product(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2, 8)}`,
    name: "Kopi Gayo 250g",
    description: "Biji kopi arabika dari dataran tinggi Gayo.",
    price: 50000,
    image_url: null,
    is_active: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const catalog: ProductRow[] = [
  product({ id: "p1", name: "Kopi Gayo 250g" }),
  product({ id: "p2", name: "Teh Melati", description: "Teh wangi tanpa pemanis.", price: 25000 }),
  product({ id: "p3", name: "Cangkir Keramik", description: "Cocok untuk kopi panas.", price: 75000 }),
];

async function renderCatalog(q?: string): Promise<string> {
  const el = await ProductsPage({ searchParams: Promise.resolve({ q }) });
  return renderToStaticMarkup(el);
}

async function renderAdmin(q?: string): Promise<string> {
  const el = await AdminProductsPage({ searchParams: Promise.resolve({ q }) });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  h.products = catalog;
});

describe("/products — pencarian katalog publik", () => {
  it("tanpa kata kunci: semua produk, tanpa sorotan, jumlah produk tampil", async () => {
    const html = await renderCatalog();

    expect(html).toContain("3 produk siap dipesan.");
    expect(html).not.toContain("<mark");
    expect(html).toContain("Kopi Gayo 250g");
    expect(html).toContain("Teh Melati");
  });

  it("kotak pencarian tersambung ke /products (GET, tanpa JS)", async () => {
    const html = await renderCatalog("kopi");

    expect(html).toContain('action="/products"');
    expect(html).toContain('method="get"');
    expect(html).toContain('role="search"');
    expect(html).toContain('name="q"');
    expect(html).toContain('value="kopi"');
  });

  it("menyaring hasil, menampilkan hitungan, dan menyorot kata kunci", async () => {
    const html = await renderCatalog("kopi");

    // p1 cocok di nama, p3 hanya di deskripsi; p2 tidak mengandung "kopi".
    expect(html).toContain("2</strong> dari 3 produk cocok");
    expect(html).toContain('<mark class="search-hit">Kopi</mark>');
    expect(html).not.toContain("Teh Melati");
  });

  it("kecocokan deskripsi ditampilkan sebagai potongan yang ikut disorot", async () => {
    const html = await renderCatalog("keramik");

    expect(html).toContain("Cangkir");
    expect(html).toContain('<mark class="search-hit">Keramik</mark>');
  });

  it("tanpa hasil: empty state pencarian + jalan keluar 'Hapus pencarian'", async () => {
    const html = await renderCatalog("sepatu");

    expect(html).toContain("Tidak ada produk untuk");
    expect(html).toContain("sepatu");
    expect(html).toContain('href="/products"');
    expect(html).not.toContain("Kopi Gayo 250g");
  });

  it("kata kunci 1 huruf tidak menyaring apa pun", async () => {
    const html = await renderCatalog("k");

    expect(html).toContain("3 produk siap dipesan.");
    expect(html).toContain("Kopi Gayo 250g");
    expect(html).not.toContain("<mark");
  });

  it("katalog kosong tetap menampilkan empty state katalog (bukan pesan pencarian)", async () => {
    h.products = [];
    const html = await renderCatalog("kopi");

    expect(html).toContain("Produk belum tersedia");
  });

  it("kata kunci yang berisi HTML selalu di-escape", async () => {
    const html = await renderCatalog('<script>alert(1)</script>');

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("metadata: halaman hasil pencarian tidak diindeks", async () => {
    const searching = await generateMetadata({ searchParams: Promise.resolve({ q: "kopi" }) });
    expect(searching.robots).toEqual({ index: false, follow: true });
    expect(String(searching.title)).toContain("kopi");

    const plain = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(plain).toEqual({ title: "Daftar Produk" });
  });
});

describe("/admin/products — pencarian daftar produk penjual", () => {
  it("tanpa kata kunci: seluruh produk (termasuk nonaktif) + jumlah katalog", async () => {
    h.products = [...catalog, product({ id: "p4", name: "Topi Bordir", is_active: false })];
    const html = await renderAdmin();

    expect(html).toContain("4 produk di katalog toko.");
    expect(html).toContain("Topi Bordir");
    expect(html).toContain("Nonaktif");
  });

  it("menyaring produk penjual dan menyorot kata kunci", async () => {
    h.products = [...catalog, product({ id: "p4", name: "Topi Bordir" })];
    const html = await renderAdmin("topi");

    expect(html).toContain("1</strong> dari 4 produk cocok");
    expect(html).toContain('<mark class="search-hit">Topi</mark>');
    expect(html).not.toContain("Teh Melati");
  });

  it("produk nonaktif tetap bisa ditemukan penjual", async () => {
    h.products = [...catalog, product({ id: "p4", name: "Topi Bordir", is_active: false })];
    const html = await renderAdmin("bordir");

    // Judul disorot per kata → "Topi " + <mark>Bordir</mark>.
    expect(html).toContain("Topi <mark");
    expect(html).toContain('<mark class="search-hit">Bordir</mark>');
    expect(html).toContain("Nonaktif");
  });

  it("tanpa hasil: pesan khusus + tautan hapus pencarian (bukan 'belum ada produk')", async () => {
    const html = await renderAdmin("sepatu");

    expect(html).toContain("Tidak ada produk yang cocok dengan");
    expect(html).toContain('href="/admin/products"');
    expect(html).not.toContain("Belum ada produk.");
  });

  it("tanpa produk sama sekali: pesan 'belum ada produk' tetap dipakai", async () => {
    h.products = [];
    const html = await renderAdmin();

    expect(html).toContain("Belum ada produk.");
  });

  it("toggle produk membawa kata kunci agar hasil pencarian tidak hilang", async () => {
    const html = await renderAdmin("kopi");
    expect(html).toContain('value="/admin/products?q=kopi"');
  });

  it("menampilkan notifikasi setelah produk dihapus", async () => {
    const el = await AdminProductsPage({ searchParams: Promise.resolve({ deleted: "1" }) });
    const html = renderToStaticMarkup(el);
    expect(html).toContain("🗑️ Produk berhasil dihapus.");
    expect(html).toContain("alert-info");
  });
});
