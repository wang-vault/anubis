/**
 * ===========================================================================
 * NORMALISASI RESPONS PROVIDER PEMBAYARAN — MODUL MURNI (tanpa I/O, tanpa env)
 * ===========================================================================
 * Sengaja TIDAK meng-import "server-only" maupun `@/lib/env` agar bisa
 * di-unit-test langsung (lihat test/payment-normalize.test.ts) dan agar
 * adapter `stenly.ts` tetap tipis: adapter mengurus HTTP, modul ini mengurus
 * "bentuk data apa yang dikembalikan provider".
 *
 * Kontrak yang dipetakan di sini mengikuti dokumentasi resmi StenlyPay
 * (https://stenly.id/docs, diakses 2026-09-20). Nama field Stenly bersifat
 * tetap & terdokumentasi (`order_id`, `gross_amount`, `qr_string`,
 * `qr_image_url`, `payment_url`, `expires_at`, `status`), jadi pemetaan di
 * bawah menyebutkan field itu secara eksplisit — tidak menebak.
 */

import type { ProviderPaymentState } from "./types";

// ---------------------------------------------------------------------------
// Konversi nilai primitif
// ---------------------------------------------------------------------------

export function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Nominal uang dari provider → integer Rupiah.
 *
 * Stenly mengirim `gross_amount` sebagai number IDR. Parser ini tetap
 * menoleransi bentuk string (JSON dari bahasa lain kerap mengirim DECIMAL
 * sebagai teks: "50000.00").
 *
 * JANGAN membuang semua non-digit: "10500.00" akan menjadi 1050000 (100× lipat)
 * dan itu merusak uang sungguhan — nominal yang ditampilkan ke buyer salah, dan
 * validasi webhook menolak pembayaran yang sebenarnya sah sehingga order yang
 * SUDAH dibayar tidak pernah menjadi PAID.
 *
 * Karena itu pemisah ribuan dan pemisah desimal dibedakan: pemisah paling kanan
 * dianggap DESIMAL bila diikuti 1–2 digit, dan dianggap RIBUAN bila diikuti
 * tepat 3 digit (konvensi Rupiah, mis. "10.500"). Rupiah tidak memakai sen,
 * jadi hasil akhir dibulatkan ke integer terdekat.
 */
export function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v !== "string") return null;

  // Sisakan digit, pemisah, dan tanda minus di depan (buang "Rp", spasi, dll).
  const cleaned = v.trim().replace(/[^\d.,-]/g, "");
  const negative = /^-/.test(cleaned);
  const digitsAndSeps = cleaned.replace(/-/g, "");
  if (!/\d/.test(digitsAndSeps)) return null;

  const lastDot = digitsAndSeps.lastIndexOf(".");
  const lastComma = digitsAndSeps.lastIndexOf(",");
  const lastSep = Math.max(lastDot, lastComma);

  let intPart = digitsAndSeps;
  let fracPart = "";
  if (lastSep !== -1) {
    const tail = digitsAndSeps.slice(lastSep + 1);
    // 1–2 digit setelah pemisah terakhir = sen/desimal; 3 digit = pemisah ribuan.
    if (/^\d{1,2}$/.test(tail)) {
      intPart = digitsAndSeps.slice(0, lastSep);
      fracPart = tail;
    }
  }

  const intDigits = intPart.replace(/[.,]/g, "");
  if (intDigits.length === 0 && fracPart.length === 0) return null;

  const value = Number.parseFloat(`${intDigits || "0"}.${fracPart || "0"}`);
  if (!Number.isFinite(value)) return null;
  return Math.round(negative ? -value : value);
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
// Nama field menurut dokumentasi Stenly (urut = prioritas)
// ---------------------------------------------------------------------------

/**
 * Identitas transaksi Stenly = `order_id` (ID invoice yang KITA kirim).
 * Endpoint status (`GET /api/v1/status/:order_id`) dan payload webhook sama-sama
 * memakainya, jadi nilai inilah yang disimpan ke `orders.payment_id`.
 */
export const STENLY_ORDER_ID_KEYS = ["order_id"] as const;

/** Nominal tagihan (docs: `gross_amount`, IDR). */
export const STENLY_AMOUNT_KEYS = ["gross_amount"] as const;

/** Halaman pembayaran siap pakai milik provider (docs: `payment_url`). */
export const STENLY_PAYMENT_URL_KEYS = ["payment_url"] as const;

/** Batas waktu bayar (docs: `expires_at`, ISO 8601 UTC). */
export const STENLY_EXPIRY_KEYS = ["expires_at"] as const;

/** String QRIS EMVCo standar (docs: `qr_string`). */
export const STENLY_QR_PAYLOAD_KEYS = ["qr_string"] as const;

/**
 * URL gambar QR milik provider (docs: `qr_image_url`).
 *
 * ⚠️ PERHATIAN KEAMANAN: contoh resmi menunjukkan nilai ini MEMBAWA SECRET KEY
 * pada query string (`/api/v1/qr/INV-…?api_key=sk_live_…`). Karena itu adapter
 * TIDAK PERNAH mengirim URL ini ke browser; QR dirender lokal dari `qr_string`
 * (lihat ./qr-render.ts). Konstanta ini hanya dipakai untuk diagnostik.
 */
export const STENLY_QR_IMAGE_KEYS = ["qr_image_url"] as const;

// ---------------------------------------------------------------------------
// Pembersihan URL: jangan pernah membocorkan kredensial ke browser
// ---------------------------------------------------------------------------

/** Nama query-param yang membawa kredensial pada URL Stenly. */
const SECRET_QUERY_PARAMS = ["api_key", "apikey", "key", "secret", "token"];

export interface SanitizedUrl {
  /** URL tanpa parameter rahasia — aman disimpan & dikirim ke browser. */
  url: string | null;
  /** true bila ada parameter rahasia yang dibuang. */
  hadSecret: boolean;
}

/**
 * Buang query-param kredensial dari URL provider.
 *
 * Dipakai untuk `payment_url` (pada project sandbox, dokumentasi menyebut URL
 * membawa API key test) sebelum nilai itu disimpan ke database / dirender di
 * halaman pembayaran buyer. Hanya http(s) yang diterima; skema lain → null.
 */
export function sanitizeProviderUrl(value: unknown): SanitizedUrl {
  const raw = asString(value);
  if (!raw) return { url: null, hadSecret: false };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { url: null, hadSecret: false };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { url: null, hadSecret: false };
  }
  let hadSecret = false;
  for (const param of [...parsed.searchParams.keys()]) {
    if (SECRET_QUERY_PARAMS.includes(param.toLowerCase())) {
      parsed.searchParams.delete(param);
      hadSecret = true;
    }
  }
  // Naikkan http → https (kecuali localhost) agar tidak jadi mixed content.
  if (parsed.protocol === "http:" && !/^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)) {
    parsed.protocol = "https:";
  }
  return { url: parsed.toString(), hadSecret };
}

// ---------------------------------------------------------------------------
// QRIS payload
// ---------------------------------------------------------------------------

/** Karakter yang muncul di payload EMVCo/BRCode QRIS. */
const EMVCO_CHARSET = /^[0-9A-Za-z.*$%+\-:/ ]+$/;

/**
 * Apakah string ini payload QRIS EMVCo yang masuk akal?
 *
 * Konservatif: payload QRIS selalu diawali indikator format "0002" (tag 00,
 * panjang 02) dan hanya memuat karakter TLV. Nilai yang tidak lolos TIDAK
 * dirender (UI jatuh ke tombol "Buka Halaman Pembayaran") — lebih baik daripada
 * menampilkan QR yang salah/berbahaya.
 */
export function isQrisPayload(value: unknown): boolean {
  const s = asString(value);
  if (!s) return false;
  return s.length >= 20 && s.length <= 1200 && s.startsWith("0002") && EMVCO_CHARSET.test(s);
}

// ---------------------------------------------------------------------------
// Status & tanggal
// ---------------------------------------------------------------------------

/**
 * Petakan status transaksi Stenly → state internal Anubis.
 *
 * Daftar status diambil PERSIS dari dokumentasi resmi (§Siklus Status Transaksi
 * & §Webhook):
 *   production : pending | paid | expired | cancelled
 *   sandbox    : sandbox_trx_pending | sandbox_trx_paid | sandbox_trx_expired
 *                | sandbox_trx_cancelled
 *   rekonsiliasi: paid_after_expiry — "bayar sebelum expired yang terdeteksi
 *                telat. Perlakukan sama seperti paid." (contoh kode resmi)
 *
 * Status di luar daftar → "unknown" (tidak pernah mengubah order).
 */
export function mapStenlyStatus(status: string | null): ProviderPaymentState | "unknown" {
  switch ((status ?? "").trim().toLowerCase()) {
    case "paid":
    case "paid_after_expiry":
    case "sandbox_trx_paid":
      return "paid";
    case "pending":
    case "sandbox_trx_pending":
      return "pending";
    case "expired":
    case "sandbox_trx_expired":
      return "expired";
    case "cancelled":
    case "sandbox_trx_cancelled":
      return "failed";
    default:
      return "unknown";
  }
}

/**
 * Parse timestamp provider → ISO string.
 *
 * Stenly mengirim ISO 8601 UTC ("2026-08-29T07:20:00.000Z"). `tzOffset` hanya
 * dipakai sebagai jaring pengaman bila suatu saat datang string tanpa zona
 * waktu — tanpa itu, JS akan menafsirkannya sebagai waktu lokal server (UTC di
 * Vercel) dan countdown buyer meleset berjam-jam.
 */
export function parseProviderDate(v: unknown, tzOffset = "+07:00"): string | null {
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
