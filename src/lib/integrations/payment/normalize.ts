/**
 * ===========================================================================
 * NORMALISASI RESPONS PROVIDER PEMBAYARAN — MODUL MURNI (tanpa I/O, tanpa env)
 * ===========================================================================
 * Sengaja TIDAK meng-import "server-only" maupun `@/lib/env` agar bisa
 * di-unit-test langsung (lihat test/payment-normalize.test.ts) dan agar
 * adapter `yobasepay.ts` tetap tipis: adapter mengurus HTTP, modul ini
 * mengurus "bentuk data apa yang dikembalikan provider".
 *
 * Kenapa modul ini ada: dokumentasi publik YoBasePay tidak lagi bisa diakses
 * tanpa login (per 2026-09-12), sehingga nama field & format nilai QR
 * bervariasi antar paket (V1/V2/V3/V4/MyPG). Semua varian yang diketahui
 * ditangani di sini — bukan tersebar di kode bisnis.
 */

import type { ProviderPaymentState } from "./types";

// ---------------------------------------------------------------------------
// Konversi nilai primitif
// ---------------------------------------------------------------------------

export function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.trim().replace(/[^\d-]/g, "");
    if (cleaned.length === 0 || cleaned === "-") return null;
    const n = Number.parseInt(cleaned, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Ambil string pertama yang terisi dari daftar nama field kandidat. */
export function pickString(
  data: Record<string, unknown>,
  keys: readonly string[],
): { value: string; key: string } | null {
  for (const key of keys) {
    const value = asString(data[key]);
    if (value) return { value, key };
  }
  return null;
}

/** Ambil angka pertama yang terisi dari daftar nama field kandidat. */
export function pickNumber(
  data: Record<string, unknown>,
  keys: readonly string[],
): { value: number; key: string } | null {
  for (const key of keys) {
    const value = asNumber(data[key]);
    if (value !== null) return { value, key };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Katalog nama field yang diketahui (urut = prioritas)
// ---------------------------------------------------------------------------

/** ID transaksi provider (disimpan ke `orders.payment_id`). */
export const TRX_ID_KEYS = [
  "trx_id",
  "trxid",
  "transaction_id",
  "trxId",
  "invoice_id",
  "payment_id",
  "id",
] as const;

/** Halaman pembayaran milik provider (fallback bila gambar QR tak tersedia). */
export const PAYMENT_URL_KEYS = [
  "payment_url",
  "pay_url",
  "checkout_url",
  "invoice_url",
  "payment_link",
  "paymentUrl",
  "url",
  "link",
] as const;

/** Nominal final yang ditagih provider (total + kode unik). */
export const AMOUNT_KEYS = [
  "amount",
  "receive_amount",
  "unique_amount",
  "total_amount",
  "charged_amount",
  "final_amount",
  "nominal",
] as const;

/** Batas waktu bayar (datetime tanpa zona waktu → lihat parseProviderDate). */
export const EXPIRY_KEYS = [
  "expired_at",
  "expires_at",
  "expired",
  "expiry",
  "expire_at",
  "expired_date",
  "expired_time",
  "due_at",
] as const;

/**
 * Field yang (di berbagai versi API) memuat GAMBAR QR: URL absolut, path
 * relatif, atau base64. Urutan = paling spesifik dulu.
 */
export const QR_IMAGE_KEYS = [
  "qr_image",
  "qr_image_url",
  "qris_url",
  "qr_url",
  "qris_image",
  "qris_image_url",
  "qr_code_url",
  "qr_code_image",
  "qrcode_url",
  "qr_img",
  "image_url",
  "qr_image_base64",
  "qr_base64",
  "qr",
  "qr_code",
  "qrcode",
  "qris",
] as const;

/**
 * Field yang memuat PAYLOAD QRIS (string EMVCo/BRCode) — bukan gambar.
 * Bila hanya ini yang ada, aplikasi tidak bisa merender QR sendiri tanpa
 * encoder; see `renderPayloadToUrl()` untuk escape hatch-nya.
 */
export const QR_PAYLOAD_KEYS = [
  "qr_string",
  "qris_string",
  "qr_payload",
  "qris_payload",
  "qr_content",
  "qris_content",
  "qr_data",
  "qris_data",
  "qr_text",
  "qr_value",
  "qr_raw",
  "brcode",
  "br_code",
  "payload",
] as const;

// ---------------------------------------------------------------------------
// Klasifikasi nilai QR
// ---------------------------------------------------------------------------

export type QrValueKind =
  | "image-url"
  | "data-uri"
  | "base64-image"
  | "emvco-payload"
  | "unknown";

const DATA_URI_IMAGE = /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i;
/** Skema URL yang boleh dipakai sebagai sumber gambar. */
const SAFE_URL_SCHEME = /^(https?|\/\/)/i;
/** Karakter yang muncul di payload EMVCo/BRCode QRIS. */
const EMVCO_CHARSET = /^[0-9A-Za-z.*-]+$/;
/** Base64 murni (tanpa prefix data:) — panjang & padding khas. */
const BASE64_BLOB = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Tebak jenis nilai QR yang dikembalikan provider.
 * Heuristik sengaja konservatif: lebih baik "unknown" (UI menampilkan tombol
 * halaman pembayaran) daripada merender sesuatu yang salah.
 */
export function classifyQrValue(value: string): QrValueKind {
  const s = value.trim();
  if (s.length === 0) return "unknown";

  // 1) data URI gambar (provider tertentu mengirim gambar inline).
  if (s.startsWith("data:")) return DATA_URI_IMAGE.test(s) ? "data-uri" : "unknown";
  // 2) URL absolut http(s) atau protocol-relative.
  if (SAFE_URL_SCHEME.test(s)) return "image-url";
  // 3) Path absolut pada host provider ("/assets/qr/x.png", "/qr/ABC123").
  //    Ekstensi tidak disyaratkan: sebagian provider memberi URL dinamis.
  if (s.startsWith("/") && !s.includes(" ")) return "image-url";
  // 4) Payload QRIS: TLV EMVCo, diawali indikator format "00".
  if (s.length >= 20 && s.startsWith("00") && EMVCO_CHARSET.test(s)) return "emvco-payload";
  // 5) Blob base64 tanpa prefix: harus punya ciri base64 (huruf kecil / + / =).
  if (s.length >= 64 && s.length % 4 === 0 && BASE64_BLOB.test(s) && /[a-z+/=]/.test(s)) {
    return "base64-image";
  }
  // 6) Path relatif ("qr/x.png") — dicek SETELAH base64 karena base64 bisa
  //    memuat "/" sementara karakter path tidak memuat "+" atau "=".
  if (/^[\w.-]+\/[\w./-]+$/.test(s) && !/[+=]/.test(s)) return "image-url";
  return "unknown";
}

/**
 * Ubah nilai URL dari provider menjadi URL absolut yang aman dirender.
 *  - `https://…`          → dipakai apa adanya
 *  - `http://…`           → dinaikkan ke https (menghindari mixed content)
 *  - `//host/path`        → diberi skema https
 *  - `/path` / `path`     → di-resolve terhadap origin base URL provider
 *  - skema lain           → null (mis. `javascript:` — jangan pernah dirender)
 */
export function resolveProviderUrl(value: string, baseUrl: string): string | null {
  const s = value.trim();
  if (s.length === 0) return null;
  if (s.startsWith("data:")) return null; // ditangani terpisah sebagai data URI
  if (/^https:\/\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) {
    // localhost dibiarkan http (pengembangan lokal); sisanya dinaikkan.
    return /^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/i.test(s)
      ? s
      : `https://${s.slice("http://".length)}`;
  }
  if (s.startsWith("//")) return `https:${s}`;
  // Tolak skema eksplisit lain sebelum memperlakukan nilai sebagai path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  try {
    const { origin } = new URL(baseUrl);
    return new URL(s.startsWith("/") ? s : `/${s}`, origin).toString();
  } catch {
    return null;
  }
}

/** Bungkus blob base64 menjadi data URI gambar (PNG bila mime tak diketahui). */
export function base64ToDataUri(value: string, mime = "image/png"): string | null {
  const s = value.trim().replace(/\s+/g, "");
  if (s.length === 0 || !BASE64_BLOB.test(s)) return null;
  const safeMime = /^image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(mime) ? mime : "image/png";
  return `data:${safeMime};base64,${s}`;
}

export interface QrExtraction {
  /** Sumber gambar siap pakai untuk atribut `src` (URL absolut atau data URI). */
  imageUrl: string | null;
  /** Payload QRIS mentah bila provider hanya memberi string (bukan gambar). */
  payload: string | null;
  /** Nama field tempat nilai diambil — untuk log/diagnostik. */
  fieldUsed: string | null;
  /** Jenis nilai yang terdeteksi — untuk log/diagnostik. */
  kind: QrValueKind | null;
}

/**
 * Cari gambar QR di respons provider, menoleransi:
 * nama field berbeda, URL relatif/protocol-relative, base64 (dengan atau
 * tanpa prefix `data:`), dan payload EMVCo.
 */
export function extractQr(
  data: Record<string, unknown>,
  baseUrl: string,
): QrExtraction {
  const candidates: readonly string[] = [...QR_IMAGE_KEYS, ...QR_PAYLOAD_KEYS];
  let payload: { value: string; key: string } | null = null;

  for (const key of candidates) {
    const value = asString(data[key]);
    if (!value) continue;
    const kind = classifyQrValue(value);

    if (kind === "image-url") {
      const url = resolveProviderUrl(value, baseUrl);
      if (url) return { imageUrl: url, payload: null, fieldUsed: key, kind };
      continue;
    }
    if (kind === "data-uri") {
      return { imageUrl: value.trim(), payload: null, fieldUsed: key, kind };
    }
    if (kind === "base64-image") {
      const mime = asString(data[`${key}_mime`]) ?? asString(data.qr_mime) ?? "image/png";
      const uri = base64ToDataUri(value, mime);
      if (uri) return { imageUrl: uri, payload: null, fieldUsed: key, kind };
      continue;
    }
    if (kind === "emvco-payload" && !payload) {
      payload = { value, key };
      continue;
    }
    // "unknown": lewati — UI akan memakai tombol "Buka Halaman Pembayaran"
    // dan adapter mencatat nama field yang tersedia untuk diagnosa.
  }

  return {
    imageUrl: null,
    payload: payload?.value ?? null,
    fieldUsed: payload?.key ?? null,
    kind: payload ? "emvco-payload" : null,
  };
}

/**
 * Escape hatch bila provider hanya memberi PAYLOAD QRIS (bukan gambar):
 * render lewat layanan pembuat gambar QR yang dikonfigurasi penjual, mis.
 *   https://api.qrserver.com/v1/create-qr-code/?size=320x320&data={payload}
 * Template WAJIB https dan memuat placeholder `{payload}` (di-URL-encode).
 * Return null bila tidak dikonfigurasi → UI memakai tombol halaman pembayaran.
 */
export function renderPayloadToUrl(payload: string, template: string | null): string | null {
  if (!template || !payload) return null;
  if (!template.includes("{payload}")) return null;
  try {
    const url = template.replace(/\{payload\}/g, encodeURIComponent(payload));
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Status & tanggal
// ---------------------------------------------------------------------------

/** Petakan status provider → state internal (varian nama ditoleransi). */
export function mapStatus(status: string | null): ProviderPaymentState | "unknown" {
  switch ((status ?? "").trim().toUpperCase()) {
    case "SUCCESS":
    case "SUCCESSFUL":
    case "PAID":
    case "COMPLETED":
    case "COMPLETE":
    case "SETTLED":
    case "LUNAS":
      return "paid";
    case "EXPIRED":
    case "EXPIRE":
    case "TIMEOUT":
      return "expired";
    case "FAILED":
    case "FAILURE":
    case "CANCELLED":
    case "CANCELED":
    case "REVERSED":
    case "REFUNDED":
    case "DENIED":
      return "failed";
    case "PENDING":
    case "WAITING_PAYMENT":
    case "WAITING":
    case "UNPAID":
    case "IN_PROGRESS":
    case "PROCESS":
    case "CREATED":
    case "NEW":
      return "pending";
    default:
      return "unknown";
  }
}

/**
 * "2026-01-01 12:00:00" (tanpa zona waktu) → ISO string.
 * `tzOffset` dipakai hanya bila string tidak memuat informasi zona.
 */
export function parseProviderDate(v: unknown, tzOffset: string): string | null {
  const s = asString(v);
  if (!s) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const iso = s.includes("T")
    ? hasZone
      ? s
      : `${s}${tzOffset}`
    : `${s.replace(" ", "T")}${hasZone ? "" : tzOffset}`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}
