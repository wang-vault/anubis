/**
 * ===========================================================================
 * METODE PEMBAYARAN — definisi murni (tanpa I/O, tanpa server-only).
 * ===========================================================================
 * File ini sengaja TIDAK meng-import apa pun agar bisa dipakai komponen klien
 * maupun di-unit-test. Konfigurasi yang butuh env/DB ada di ./payment-config.ts.
 *
 * Dua metode:
 *  - STENLY : QRIS dinamis, dibuat via API Stenly (StenlyPay), lunas
 *             diverifikasi otomatis (webhook / polling ke provider).
 *  - MANUAL : QRIS statis milik penjual (mis. QR GoPay Merchant). Buyer scan
 *             & transfer sendiri, lalu menekan "Saya sudah transfer";
 *             penjual mencocokkan mutasi lalu mengonfirmasi di dashboard.
 *
 * KOMPATIBILITAS HISTORIS: order lama dibuat saat provider otomatis masih
 * YoBasePay dan menyimpan `payment_method = 'YOBASEPAY'` di database. Nilai itu
 * TIDAK dimigrasikan (histori transaksi tidak boleh diubah) — ia tetap dikenali
 * sebagai "QRIS otomatis" untuk keperluan baca/tampil saja. Order BARU selalu
 * memakai STENLY.
 */

export const PAYMENT_METHODS = ["STENLY", "MANUAL"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Metode otomatis pada order lama (provider sebelumnya). Hanya untuk dibaca —
 * tidak pernah dipakai untuk order baru dan tidak bisa dipilih buyer.
 */
export const LEGACY_PAYMENT_METHOD_AUTO = "YOBASEPAY";

/** Nilai `payment_method` yang pernah/boleh ada di database (baca-saja). */
export type StoredPaymentMethod = PaymentMethod | typeof LEGACY_PAYMENT_METHOD_AUTO;

export const PAYMENT_METHOD_AUTO: PaymentMethod = "STENLY";
export const PAYMENT_METHOD_MANUAL: PaymentMethod = "MANUAL";

/** Label singkat yang dipakai UI & notifikasi. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  STENLY: "QRIS Otomatis",
  MANUAL: "Transfer Manual",
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/**
 * true bila nilai `payment_method` berarti "QRIS otomatis" — termasuk order
 * lama bernilai YOBASEPAY. Dipakai UI/telegram agar histori tetap terbaca
 * benar tanpa menyentuh datanya.
 */
export function isAutoMethod(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const upper = value.trim().toUpperCase();
  return upper === PAYMENT_METHOD_AUTO || upper === LEGACY_PAYMENT_METHOD_AUTO;
}

/**
 * Normalisasi input metode pembayaran. Nilai tak dikenal → fallback
 * (fallback ditentukan konfigurasi server, BUKAN dari klien).
 */
export function normalizePaymentMethod(
  value: unknown,
  fallback: PaymentMethod,
): PaymentMethod {
  if (typeof value === "string") {
    const upper = value.trim().toUpperCase();
    if (isPaymentMethod(upper)) return upper;
  }
  return fallback;
}

/** true bila pembayaran diverifikasi manual oleh penjual. */
export function isManualMethod(method: PaymentMethod | string | null | undefined): boolean {
  return method === PAYMENT_METHOD_MANUAL;
}

/**
 * Kode unik nominal untuk transfer MANUAL (1..max, default 1..999).
 *
 * Kenapa perlu: QRIS statis tidak bisa mengisi nominal otomatis, jadi buyer
 * mengetik nominal sendiri. Tambahan beberapa ratus rupiah membuat setiap mutasi
 * punya "sidik jari" unik → penjual bisa mencocokkan transfer dengan order tanpa
 * bertanya ke buyer.
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
 * Nominal manual tidak punya webhook, jadi penjual yang memverifikasi — helper
 * ini hanya dipakai untuk menolak salah ketik yang jelas (kurang dari total).
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

/** Deskripsi satu metode untuk dipilih buyer di halaman checkout. */
export interface AvailablePaymentMethod {
  id: PaymentMethod;
  label: string;
  note: string;
  disabled?: boolean;
  isOngoing?: boolean;
  statusBadge?: string;
}
