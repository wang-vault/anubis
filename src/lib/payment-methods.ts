/**
 * ===========================================================================
 * METODE PEMBAYARAN — definisi murni (tanpa I/O, tanpa server-only).
 * ===========================================================================
 * File ini sengaja TIDAK meng-import apa pun agar bisa dipakai komponen klien
 * maupun di-unit-test. Konfigurasi yang butuh env/DB ada di ./payment-config.ts.
 *
 * SATU METODE: **MANUAL via WhatsApp**.
 *   Buyer membuat order → halaman pembayaran menampilkan tombol chat WhatsApp
 *   ke penjual (pesan sudah terisi kode order + nominal) → penjual mengirim
 *   detail pembayaran (QRIS statis / rekening / e-wallet) DI CHAT → buyer
 *   transfer → buyer menekan "Saya sudah transfer" (masuk antrian verifikasi)
 *   → penjual mencocokkan mutasi lalu menandai lunas di dashboard.
 *
 *   Tidak ada provider pembayaran, tidak ada webhook, tidak ada QR yang
 *   dirender aplikasi: seluruh koordinasi pembayaran terjadi di WhatsApp.
 *
 * KOMPATIBILITAS HISTORIS (baca-saja).
 *   Order lama bisa menyimpan `payment_method = 'STENLY'` (QRIS otomatis
 *   terakhir) atau `'YOBASEPAY'` (provider sebelumnya). Nilai itu TIDAK
 *   dimigrasikan — histori transaksi tidak boleh diubah — dan tetap dikenali
 *   sebagai "QRIS otomatis (lama)" untuk keperluan baca/tampil saja.
 *   Order BARU selalu 'MANUAL'.
 */

export const PAYMENT_METHODS = ["MANUAL"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Provider QRIS otomatis terakhir yang pernah dipakai (arsip, baca-saja). */
export const LEGACY_PAYMENT_METHOD_STENLY = "STENLY";
/** Provider QRIS otomatis sebelum Stenly (arsip, baca-saja). */
export const LEGACY_PAYMENT_METHOD_AUTO = "YOBASEPAY";

export const LEGACY_PAYMENT_METHODS = [
  LEGACY_PAYMENT_METHOD_STENLY,
  LEGACY_PAYMENT_METHOD_AUTO,
] as const;
export type LegacyPaymentMethod = (typeof LEGACY_PAYMENT_METHODS)[number];

/** Nilai `payment_method` yang pernah/boleh ada di database (baca-saja). */
export type StoredPaymentMethod = PaymentMethod | LegacyPaymentMethod;

export const PAYMENT_METHOD_MANUAL: PaymentMethod = "MANUAL";

/** Label singkat yang dipakai UI & notifikasi. */
export const PAYMENT_METHOD_LABELS: Record<StoredPaymentMethod, string> = {
  MANUAL: "Transfer Manual (WhatsApp)",
  STENLY: "QRIS Otomatis (lama)",
  YOBASEPAY: "QRIS Otomatis (lama)",
};

/** Label aman untuk nilai apa pun yang datang dari database. */
export function paymentMethodLabel(value: unknown): string {
  return isStoredPaymentMethod(value)
    ? PAYMENT_METHOD_LABELS[value]
    : PAYMENT_METHOD_LABELS[PAYMENT_METHOD_MANUAL];
}

export function isStoredPaymentMethod(value: unknown): value is StoredPaymentMethod {
  return (
    typeof value === "string" &&
    (value === PAYMENT_METHOD_MANUAL ||
      (LEGACY_PAYMENT_METHODS as readonly string[]).includes(value))
  );
}

/**
 * true bila nilai `payment_method` berarti "QRIS otomatis" — hanya mungkin pada
 * order ARSIP. Dipakai UI/telegram agar histori tetap terbaca benar tanpa
 * menyentuh datanya.
 */
export function isLegacyAutoMethod(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const upper = value.trim().toUpperCase();
  return (LEGACY_PAYMENT_METHODS as readonly string[]).includes(upper);
}

/**
 * Normalisasi input dari klien. Karena sekarang hanya ada SATU metode, apa pun
 * nilai yang dikirim selalu jatuh ke MANUAL — klien tidak pernah bisa memilih
 * jalur pembayaran lain.
 */
export function normalizePaymentMethod(_value?: unknown): PaymentMethod {
  return PAYMENT_METHOD_MANUAL;
}

/** true bila pembayaran diverifikasi manual oleh penjual. */
export function isManualMethod(method: PaymentMethod | string | null | undefined): boolean {
  return method === PAYMENT_METHOD_MANUAL;
}

/**
 * Kode unik nominal untuk transfer MANUAL (1..max, default 1..999).
 *
 * Kenapa perlu: pembayaran dilakukan di luar aplikasi (transfer/QRIS statis),
 * jadi buyer mengetik nominal sendiri. Tambahan beberapa ratus rupiah membuat
 * setiap mutasi punya "sidik jari" unik → penjual bisa mencocokkan transfer
 * dengan order tanpa harus bertanya ke buyer.
 *
 * Deterministik dari order_code (FNV-1a) agar nominal yang sama selalu muncul
 * walau halaman di-render ulang, tanpa perlu menyimpan angka acak tambahan.
 */
export function manualUniqueCode(orderCode: string, max = 999): number {
  if (max < 1) return 0;
  const clean = (orderCode ?? "").trim().toUpperCase();
  let hash = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < clean.length; i++) {
    hash ^= clean.charCodeAt(i);
    // hash *= 16777619, dikerjakan dengan Math.imul agar tetap 32-bit aman.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % max) + 1;
}

/** Nominal yang harus ditransfer buyer untuk pembayaran manual. */
export function manualChargedAmount(totalAmount: number, orderCode: string): number {
  return Math.max(0, Math.trunc(totalAmount)) + manualUniqueCode(orderCode);
}

/**
 * Apakah nominal yang masuk cocok dengan order manual?
 * Nominal manual diverifikasi manusia, jadi helper ini hanya dipakai untuk
 * menolak salah ketik yang jelas (kurang dari total order).
 */
export function manualAmountAcceptable(
  received: number,
  orderTotal: number,
  maxCode = 999,
): boolean {
  return (
    Number.isFinite(received) &&
    received >= orderTotal &&
    received <= orderTotal + maxCode
  );
}

/** Deskripsi metode pembayaran yang ditampilkan di UI checkout. */
export interface AvailablePaymentMethod {
  id: PaymentMethod;
  label: string;
  note: string;
  disabled?: boolean;
}
