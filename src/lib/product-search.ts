/**
 * PENCARIAN PRODUK — murni (tanpa I/O), dipakai halaman katalog publik
 * (`/products`) dan daftar produk penjual (`/admin/products`).
 *
 * Prinsip:
 *  - Pencarian dilakukan DI MEMORI atas daftar produk yang sudah dibaca
 *    server-side. Tidak ada query LIKE/SQL tambahan → tidak ada risiko injeksi
 *    filter PostgREST (`,`, `%`, `_`, `.`, `(`, `)`, `\` hanya dianggap pemisah
 *    kata oleh normalisasi di bawah) dan tidak ada tabel/index baru.
 *  - Case-insensitive + tahan diakritik ("Café" = "cafe").
 *  - Kata kunci dipecah menjadi token; SEMUA token harus cocok (AND), tiap
 *    token cukup muncul sebagai bagian dari kata (substring) di nama,
 *    deskripsi, atau angka harga.
 *  - Hasil diurutkan menurut relevansi (nama > deskripsi/harga), stabil:
 *    produk dengan skor sama tetap mengikuti urutan asli (terbaru dulu).
 */

import type { ProductRow } from "@/lib/types";

/** Panjang minimum kata kunci agar pencarian aktif. */
export const PRODUCT_SEARCH_MIN_LEN = 2;
/** Batas panjang kata kunci yang diproses (sisanya dipotong). */
export const PRODUCT_SEARCH_MAX_LEN = 60;
/** Panjang potongan deskripsi yang ditampilkan pada hasil pencarian. */
export const PRODUCT_SNIPPET_LEN = 130;
/** Batas jumlah sorotan per teks (jaring pengaman untuk deskripsi panjang). */
const MAX_HIGHLIGHT_RANGES = 40;

// ---------------------------------------------------------------------------
// Normalisasi (menyimpan peta posisi agar sorotan bisa dipetakan balik)
// ---------------------------------------------------------------------------

interface NormalizedText {
  /** Huruf kecil, tanda baca → spasi, spasi tunggal, tanpa diakritik. */
  text: string;
  /** spans[i] = rentang karakter ASLI yang menghasilkan text[i]. */
  spans: { start: number; end: number }[];
}

const COMBINING_MARKS = /\p{M}+/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Normalisasi + peta posisi; dipakai untuk pencocokan, sorotan, dan snippet. */
function normalizeWithSpans(raw: string): NormalizedText {
  const out: string[] = [];
  const spans: { start: number; end: number }[] = [];
  let offset = 0;

  for (const ch of raw) {
    // NFKD lalu buang tanda diakritik → "é" jadi "e"; toLowerCase aman untuk
    // teks Indonesia dan tidak mengubah posisi karakter aslinya.
    const folded = ch.normalize("NFKD").replace(COMBINING_MARKS, "").toLowerCase();
    const letters = Array.from(folded);
    const isWord = letters.length > 0 && letters.every((l) => WORD_CHAR.test(l));

    if (isWord) {
      for (const letter of letters) {
        out.push(letter);
        spans.push({ start: offset, end: offset + ch.length });
      }
    } else if (out.length > 0 && out[out.length - 1] !== " ") {
      // Pemisah apa pun (. , - _ % ( ) \ / dst.) menjadi SATU spasi.
      out.push(" ");
      spans.push({ start: offset, end: offset + ch.length });
    }

    offset += ch.length;
  }

  // Buang spasi di ujung supaya token tidak kosong.
  while (out.length > 0 && out[out.length - 1] === " ") {
    out.pop();
    spans.pop();
  }

  return { text: out.join(""), spans };
}

/** Kata kunci untuk ditampilkan pada form: rapatkan spasi + potong panjangnya. */
export function normalizeSearchTerm(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, PRODUCT_SEARCH_MAX_LEN);
}

export interface ProductSearchState {
  /** Kata kunci seperti diketik user (sudah dirapikan) — untuk value form. */
  term: string;
  /** Kata kunci ternormalisasi yang harus muncul utuh (bonus relevansi). */
  needle: string;
  /** Token (≥ 2 huruf) yang semuanya harus cocok. */
  tokens: string[];
  /** true = filter benar-benar diterapkan. */
  active: boolean;
}

/** Ubah input mentah (`?q=`) menjadi keadaan pencarian yang siap dipakai. */
export function buildProductSearch(raw: unknown): ProductSearchState {
  const term = normalizeSearchTerm(raw);
  const normalized = normalizeWithSpans(term).text;
  const tokens = normalized.split(" ").filter((t) => t.length >= PRODUCT_SEARCH_MIN_LEN);
  return {
    term,
    needle: tokens.join(" "),
    tokens,
    active: tokens.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Pencocokan & peringkat
// ---------------------------------------------------------------------------

interface Haystack {
  name: string;
  description: string;
  price: string;
  all: string;
}

function haystackOf(product: Pick<ProductRow, "name" | "description" | "price">): Haystack {
  const name = normalizeWithSpans(product.name ?? "").text;
  const description = normalizeWithSpans(product.description ?? "").text;
  // Angka harga mentah ("50000") supaya "50000" maupun "50 000" bisa ditemukan.
  const price = String(product.price ?? "");
  return { name, description, price, all: `${name} ${description} ${price}` };
}

/**
 * Relevansi: kecocokan di NAMA jauh lebih berharga daripada deskripsi/harga.
 * Urutan hasil akhir = skor turun, lalu urutan asli (produk terbaru dulu).
 */
function scoreOf(hay: Haystack, search: ProductSearchState): number {
  let score = 0;
  if (search.needle && hay.name.includes(search.needle)) score += 60;
  if (search.needle && hay.name.startsWith(search.needle)) score += 40;
  for (const token of search.tokens) {
    if (hay.name.includes(token)) score += 12;
    else if (hay.description.includes(token)) score += 4;
    else if (hay.price.includes(token)) score += 2;
  }
  return score;
}

export interface ProductSearchOutcome {
  search: ProductSearchState;
  /** Produk yang lolos filter (semua produk bila pencarian tidak aktif). */
  products: ProductRow[];
  /** Jumlah produk sebelum difilter. */
  total: number;
  /** Jumlah produk yang cocok. */
  matchCount: number;
}

/** Filter + urutkan daftar produk menurut kata kunci mentah. */
export function applyProductSearch(
  products: readonly ProductRow[],
  raw: unknown,
): ProductSearchOutcome {
  const search = buildProductSearch(raw);
  const total = products.length;

  if (!search.active) {
    return { search, products: [...products], total, matchCount: total };
  }

  const scored: { product: ProductRow; index: number; score: number }[] = [];
  products.forEach((product, index) => {
    const hay = haystackOf(product);
    if (!search.tokens.every((token) => hay.all.includes(token))) return;
    scored.push({ product, index, score: scoreOf(hay, search) });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return { search, products: scored.map((s) => s.product), total, matchCount: scored.length };
}

// ---------------------------------------------------------------------------
// Sorotan kata kunci (highlight) + potongan deskripsi
// ---------------------------------------------------------------------------

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/** Semua kemunculan token pada teks ternormalisasi, sudah digabung & diurutkan. */
function matchRanges(
  normalized: string,
  tokens: readonly string[],
): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  for (const token of tokens) {
    if (!token) continue;
    let from = 0;
    for (;;) {
      const at = normalized.indexOf(token, from);
      if (at === -1) break;
      found.push({ start: at, end: at + token.length });
      from = at + 1; // kemunculan yang saling tumpang tindih tetap terdeteksi
    }
  }
  if (found.length === 0) return [];

  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: { start: number; end: number }[] = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }
  return merged.slice(0, MAX_HIGHLIGHT_RANGES);
}

/**
 * Pecah teks menjadi potongan biasa & potongan yang cocok dengan kata kunci,
 * supaya UI bisa menyorotnya (`<mark>`). Selalu mengembalikan teks utuh.
 */
export function highlightSegments(
  text: string,
  tokens: readonly string[],
): HighlightSegment[] {
  const source = typeof text === "string" ? text : "";
  if (!source) return [];
  if (!tokens || tokens.length === 0) return [{ text: source, hit: false }];

  const normalized = normalizeWithSpans(source);
  const ranges = matchRanges(normalized.text, tokens);
  if (ranges.length === 0) return [{ text: source, hit: false }];

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    const start = normalized.spans[range.start]?.start ?? source.length;
    const end = normalized.spans[range.end - 1]?.end ?? source.length;
    if (start < cursor || end <= start) continue;
    if (start > cursor) segments.push({ text: source.slice(cursor, start), hit: false });
    segments.push({ text: source.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), hit: false });
  return segments.length > 0 ? segments : [{ text: source, hit: false }];
}

/**
 * Potongan deskripsi untuk kartu hasil pencarian: jendela di sekitar kecocokan
 * pertama (supaya alasan produk muncul terlihat), dengan tanda "…" bila
 * dipotong. Mengembalikan null bila deskripsi kosong.
 */
export function descriptionSnippet(
  description: string | null | undefined,
  tokens: readonly string[],
  maxLen = PRODUCT_SNIPPET_LEN,
): string | null {
  const flat = (description ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= maxLen) return flat;

  const normalized = normalizeWithSpans(flat);
  const first = matchRanges(normalized.text, tokens ?? [])[0];
  if (!first) return `${flat.slice(0, maxLen).trimEnd()}…`;

  const matchStart = normalized.spans[first.start]?.start ?? 0;
  const matchEnd = normalized.spans[first.end - 1]?.end ?? flat.length;
  if (matchEnd - matchStart > maxLen) {
    return `…${flat.slice(matchStart, matchStart + maxLen).trimEnd()}…`;
  }

  // Sisakan ±1/3 jendela sebagai konteks sebelum kecocokan.
  const lead = Math.max(0, Math.floor((maxLen - (matchEnd - matchStart)) / 3));
  let start = Math.max(0, matchStart - lead);
  let end = Math.min(flat.length, start + maxLen);
  if (end < matchEnd) end = Math.min(flat.length, matchEnd);
  start = Math.max(0, Math.min(start, end - maxLen));

  const prefix = start > 0 ? "…" : "";
  const suffix = end < flat.length ? "…" : "";
  return `${prefix}${flat.slice(start, end).trim()}${suffix}`;
}
