/**
 * ===========================================================================
 * GUARD SUMBER GAMBAR QR — MODUL MURNI (dipakai komponen klien)
 * ===========================================================================
 * Satu-satunya tempat yang memutuskan "apakah nilai ini boleh masuk atribut
 * `src` sebuah <img>". Dipakai PaymentPanel untuk QRIS dinamis (provider) dan
 * QR statis penjual, sehingga keduanya tunduk pada aturan yang sama.
 *
 * Yang DITERIMA:
 *  - `https://…`                     (gambar provider / CDN)
 *  - `data:image/(png|jpeg|webp|gif);base64,…`  (provider tertentu mengirim
 *                                                gambar inline, bukan URL)
 *  - `/api/manual-qr` (path same-origin, tanpa `//`)
 *  - `http://localhost…` / `http://127.0.0.1…`  (pengembangan lokal saja)
 *
 * Yang DITOLAK: `javascript:`, `data:text/html`, URL protocol-relative
 * (`//host/…` — bisa mengarah ke domain lain), dan apa pun yang tidak dikenal.
 * Nilai yang ditolak membuat UI menampilkan tombol "Buka Halaman Pembayaran"
 * alih-alih gambar rusak.
 */

const DATA_URI_IMAGE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
const LOCAL_HTTP = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i;
/**
 * Path same-origin: diawali satu `/`, BUKAN `//`, dan TANPA backslash.
 *
 * Backslash sengaja dilarang: menurut WHATWG URL, `\` setara `/` pada URL
 * ber-skema khusus (http/https), sehingga `/\evil.com/q.png` BUKAN path —
 * browser me-resolve-nya menjadi `https://evil.com/q.png`, keluar dari
 * origin kita persis seperti `//evil.com/q.png` yang sudah ditolak di atas.
 */
const SAME_ORIGIN_PATH = /^\/(?![/\\])[^\s\\]*$/;
/** Batas panjang data URI (base64 gambar QR ± 900 KB → ~1,2 juta karakter). */
const MAX_DATA_URI_LENGTH = 2_000_000;

/** Type guard: menyempitkan `string | null | undefined` menjadi `string`.
 */
export function isRenderableQrSrc(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (s.length === 0) return false;

  if (s.startsWith("data:")) {
    return s.length <= MAX_DATA_URI_LENGTH && DATA_URI_IMAGE.test(s);
  }
  if (/^https:\/\//i.test(s)) return true;
  if (LOCAL_HTTP.test(s)) return true;
  return SAME_ORIGIN_PATH.test(s);
}
