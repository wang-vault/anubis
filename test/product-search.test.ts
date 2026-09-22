/**
 * Unit test PENCARIAN PRODUK (lib/product-search.ts) — mesin yang dipakai
 * halaman katalog publik `/products` dan daftar produk penjual
 * `/admin/products`.
 *
 * Yang dijaga:
 *  - hanya kata kunci ≥ 2 huruf yang mengaktifkan filter (1 huruf = tampilkan semua),
 *  - case-insensitive, tahan diakritik, dan mengabaikan tanda baca;
 *  - metakarakter filter PostgREST (`%`, `_`, `,`, `(`, `)`, `\`) diperlakukan
 *    sebagai pemisah kata — bukan wildcard, dan tidak ada apa pun yang di-escape
 *    ke SQL karena pencarian murni di memori;
 *  - semua token harus cocok (AND) di nama/deskripsi/harga;
 *  - hasil relevan di atas (nama > deskripsi/harga), sisanya tetap terbaru dulu;
 *  - sorotan (`<mark>`) selalu merekonstruksi teks asli apa adanya;
 *  - snippet deskripsi memuat kecocokan + tanda "…" saat dipotong.
 */
import { describe, expect, it } from "vitest";
import {
  applyProductSearch,
  buildProductSearch,
  descriptionSnippet,
  highlightSegments,
  normalizeSearchTerm,
  PRODUCT_SEARCH_MAX_LEN,
  PRODUCT_SEARCH_MIN_LEN,
  PRODUCT_SNIPPET_LEN,
} from "@/lib/product-search";
import type { ProductRow } from "@/lib/types";

function product(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2, 8)}`,
    name: "Kopi Gayo 250g",
    description: "Biji kopi arabika single origin dari dataran tinggi Gayo.",
    price: 50000,
    image_url: null,
    is_active: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeSearchTerm", () => {
  it("merapikan spasi, memotong panjang, dan menolak non-string", () => {
    expect(normalizeSearchTerm("  kopi   gayo ")).toBe("kopi gayo");
    expect(normalizeSearchTerm(undefined)).toBe("");
    expect(normalizeSearchTerm(123 as unknown as string)).toBe("");
    expect(normalizeSearchTerm("x".repeat(200))).toHaveLength(PRODUCT_SEARCH_MAX_LEN);
  });
});

describe("buildProductSearch", () => {
  it("kata kunci < 2 huruf tidak mengaktifkan filter (input dikosongkan tokennya)", () => {
    for (const raw of ["", " ", "k", "%", "  a  "]) {
      const search = buildProductSearch(raw);
      expect(search.active).toBe(false);
      expect(search.tokens).toEqual([]);
    }
  });

  it("mengaktifkan filter untuk kata kunci ≥ 2 huruf", () => {
    const search = buildProductSearch("Kopi");
    expect(search.active).toBe(true);
    expect(search.term).toBe("Kopi"); // untuk value form (huruf asli dipertahankan)
    expect(search.tokens).toEqual(["kopi"]); // untuk pencocokan
    expect(PRODUCT_SEARCH_MIN_LEN).toBe(2);
  });

  it("memecah frasa menjadi token dan mengabaikan token 1 huruf", () => {
    expect(buildProductSearch("kopi gayo").tokens).toEqual(["kopi", "gayo"]);
    expect(buildProductSearch("e kopi").tokens).toEqual(["kopi"]);
    expect(buildProductSearch("KOPI,GAYO").tokens).toEqual(["kopi", "gayo"]);
  });

  it("membuang diakritik", () => {
    expect(buildProductSearch("Café").tokens).toEqual(["cafe"]);
  });
});

describe("applyProductSearch — pencocokan", () => {
  const catalog = [
    product({ id: "a", name: "Kopi Gayo 250g", description: "Biji arabika", price: 50000 }),
    product({ id: "b", name: "Teh Melati", description: "Wangi kopi? bukan, melati.", price: 25000 }),
    product({ id: "c", name: "Cangkir Keramik", description: "Untuk minum panas.", price: 75000 }),
  ];

  it("tanpa kata kunci: semua produk, urutan asli dipertahankan", () => {
    const out = applyProductSearch(catalog, "");
    expect(out.search.active).toBe(false);
    expect(out.products.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(out.total).toBe(3);
    expect(out.matchCount).toBe(3);
  });

  it("mencari di nama dan deskripsi, tidak case-sensitive", () => {
    expect(applyProductSearch(catalog, "KOPI").products.map((p) => p.id)).toEqual(["a", "b"]);
    expect(applyProductSearch(catalog, "melati").products.map((p) => p.id)).toEqual(["b"]);
  });

  it("frasa multi-kata = AND (semua token harus ada)", () => {
    expect(applyProductSearch(catalog, "kopi arabika").products.map((p) => p.id)).toEqual(["a"]);
    expect(applyProductSearch(catalog, "kopi keramik").products).toEqual([]);
  });

  it("kecocokan di NAMA diurutkan di atas kecocokan deskripsi", () => {
    // "kopi" ada di nama produk a, hanya di deskripsi produk b.
    expect(applyProductSearch(catalog, "kopi").products.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("bisa mencari angka harga (mentah maupun berkelompok)", () => {
    expect(applyProductSearch(catalog, "75000").products.map((p) => p.id)).toEqual(["c"]);
    // "50.000" dipecah jadi token "50" + "000" → cocok dengan harga 50000.
    expect(applyProductSearch(catalog, "50.000").products[0]?.id).toBe("a");
  });

  it("metakarakter PostgREST tidak berfungsi sebagai wildcard", () => {
    // "%" dan "_" hanya jadi pemisah: tidak ada produk yang "cocok semua".
    expect(applyProductSearch(catalog, "%").search.active).toBe(false);
    expect(applyProductSearch(catalog, "%").products).toHaveLength(3);
    // "%kopi%" disamakan dengan "kopi" (bukan pola bebas).
    expect(applyProductSearch(catalog, "%kopi%").products.map((p) => p.id)).toEqual(["a", "b"]);
    // Nama produk yang mengandung "%" tetap bisa dicari lewat kata lain —
    // "%" hanya pemisah, bukan wildcard.
    const weird = [...catalog, product({ id: "d", name: "Diskon 50% Kaos", description: "" })];
    expect(applyProductSearch(weird, "kaos").products.map((p) => p.id)).toEqual(["d"]);
    expect(applyProductSearch(weird, "diskon kaos").products.map((p) => p.id)).toEqual(["d"]);
    expect(applyProductSearch(weird, "kaos_").products.map((p) => p.id)).toEqual(["d"]);
    // Angka harga yang khas hanya cocok dengan produknya sendiri.
    expect(applyProductSearch(weird, "75").products.map((p) => p.id)).toEqual(["c"]);
  });

  it("diakritik diabaikan dua arah", () => {
    const accented = [product({ id: "e", name: "Kopi Café Latte", description: "" })];
    expect(applyProductSearch(accented, "cafe").products).toHaveLength(1);
    expect(applyProductSearch([product({ id: "f", name: "Cafe Susu", description: "" })], "café").products).toHaveLength(1);
  });

  it("tidak ada hasil → matchCount 0 tapi total tetap jumlah katalog", () => {
    const out = applyProductSearch(catalog, "sepatu lari");
    expect(out.products).toEqual([]);
    expect(out.matchCount).toBe(0);
    expect(out.total).toBe(3);
  });

  it("deskripsi null/kosong tidak membuat error", () => {
    const rows = [product({ id: "g", name: "Kaos Polos", description: "" })];
    expect(applyProductSearch(rows, "kaos").products).toHaveLength(1);
    const nullDesc = [{ ...product({ id: "h", name: "Kaos Hitam" }), description: null as unknown as string }];
    expect(applyProductSearch(nullDesc, "hitam").products).toHaveLength(1);
  });

  it("tidak mengubah array masukan", () => {
    const before = catalog.map((p) => p.id);
    applyProductSearch(catalog, "kopi");
    expect(catalog.map((p) => p.id)).toEqual(before);
  });
});

describe("highlightSegments — sorotan kata kunci", () => {
  const join = (segments: { text: string }[]) => segments.map((s) => s.text).join("");
  const hits = (segments: { text: string; hit: boolean }[]) =>
    segments.filter((s) => s.hit).map((s) => s.text);

  it("menyorot semua kemunculan, teks asli tetap utuh", () => {
    const text = "Kopi Gayo, kopi panggang";
    const segments = highlightSegments(text, ["kopi"]);
    expect(join(segments)).toBe(text);
    expect(hits(segments)).toEqual(["Kopi", "kopi"]);
  });

  it("tanpa kata kunci / tanpa kecocokan → satu potongan biasa", () => {
    expect(highlightSegments("Kopi Gayo", [])).toEqual([{ text: "Kopi Gayo", hit: false }]);
    expect(highlightSegments("Kopi Gayo", ["teh"])).toEqual([{ text: "Kopi Gayo", hit: false }]);
    expect(highlightSegments("", ["kopi"])).toEqual([]);
  });

  it("memetakan posisi dengan benar saat ada diakritik & tanda baca", () => {
    const text = "Café 100%—Kopi";
    const segments = highlightSegments(text, ["cafe", "100"]);
    expect(join(segments)).toBe(text);
    expect(hits(segments)).toEqual(["Café", "100"]);
  });

  it("gabungkan kecocokan yang berdampingan tanpa memotong teks", () => {
    const text = "KopiGayo";
    const segments = highlightSegments(text, ["kopi", "gayo"]);
    expect(join(segments)).toBe(text);
    expect(hits(segments)).toEqual(["KopiGayo"]);
  });
});

describe("descriptionSnippet", () => {
  it("kosong → null; pendek → apa adanya", () => {
    expect(descriptionSnippet("", ["kopi"])).toBeNull();
    expect(descriptionSnippet("   ", ["kopi"])).toBeNull();
    expect(descriptionSnippet(null, ["kopi"])).toBeNull();
    expect(descriptionSnippet("Biji kopi pilihan.", ["kopi"])).toBe("Biji kopi pilihan.");
  });

  it("deskripsi panjang: jendela memuat kecocokan + tanda elipsis", () => {
    const long = `${"a".repeat(400)} kopi gayo ${"b".repeat(400)}`;
    const snippet = descriptionSnippet(long, ["kopi"], PRODUCT_SNIPPET_LEN)!;
    expect(snippet).toContain("kopi gayo");
    expect(snippet.length).toBeLessThanOrEqual(PRODUCT_SNIPPET_LEN + 2); // +2 untuk "…"
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("tanpa kecocokan: potongan dari awal deskripsi", () => {
    const long = "x".repeat(300);
    const snippet = descriptionSnippet(long, ["tidakada"])!;
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.startsWith("x")).toBe(true);
  });

  it("snippet tetap bisa disorot (teks asli tidak diubah)", () => {
    const long = `${"k".repeat(200)} Kopi Gayo ${"m".repeat(200)}`;
    const snippet = descriptionSnippet(long, ["gayo"])!;
    const segments = highlightSegments(snippet, ["gayo"]);
    expect(segments.map((s) => s.text).join("")).toBe(snippet);
    expect(segments.some((s) => s.hit && s.text.toLowerCase() === "gayo")).toBe(true);
  });
});
