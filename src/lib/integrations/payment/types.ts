/**
 * Kontrak PaymentProvider — abstraction layer pembayaran.
 *
 * Implementasi aktif: Stenly (StenlyPay — payment gateway QRIS). Untuk
 * mengganti provider di masa depan, cukup buat implementasi interface ini dan
 * daftarkan di ./index.ts — kode bisnis (orders.ts, webhook) tidak berubah.
 */

export interface CreatePaymentInput {
  /** Nominal dalam Rupiah (integer). Sumbernya SELALU database, bukan browser. */
  amount: number;
  /** Kode order kita (ORD-YYYYMMDD-XXXXXX) — dipakai utk pelacakan internal. */
  orderCode: string;
  description?: string;
  /** Snapshot kontak buyer (opsional; provider memakainya untuk kwitansi). */
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
}

export interface CreatedPayment {
  /**
   * ID transaksi dari provider, disimpan ke `orders.payment_id`.
   * Pada Stenly kunci transaksi adalah `order_id` yang KITA kirim (= order_code),
   * karena endpoint status & webhook memakai nilai itu.
   */
  paymentId: string;
  paymentUrl: string | null;
  /**
   * Sumber gambar QR siap render: URL https absolut ATAU `data:image/…;base64`.
   * Adapter sudah menormalisasi URL relatif/protocol-relative milik provider,
   * jadi nilai di sini selalu lolos `isRenderableQrSrc()` bila tidak null.
   */
  qrImageUrl: string | null;
  /**
   * Payload QRIS mentah (string EMVCo/BRCode) bila tersedia. Adapter Stenly
   * merendernya menjadi gambar SECARA LOKAL (package `qrcode`) sehingga payload
   * pembayaran tidak pernah dikirim ke layanan QR pihak ketiga.
   */
  qrPayload?: string | null;
  /** ISO string, boleh null bila provider tidak memberi. */
  expiresAt: string | null;
  /**
   * Nominal yang diminta provider. Stenly menagih persis `gross_amount` yang
   * kita kirim; null bila provider tidak mengembalikannya.
   */
  chargedAmount: number | null;
}

export type ProviderPaymentState = "paid" | "pending" | "expired" | "failed";

export interface PaymentStatusResult {
  state: ProviderPaymentState | "unknown";
  /** Nominal terbayang versi provider (untuk validasi), boleh null. */
  amount: number | null;
  raw: unknown;
}

/** Payload webhook yang sudah dinormalisasi provider. */
export interface NormalizedWebhook {
  paymentId: string | null;
  orderCode: string | null;
  state: ProviderPaymentState | "unknown";
  amount: number | null;
  raw: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: string;
  /** false bila kredensial provider belum diisi (metode disembunyikan dari buyer). */
  readonly isConfigured?: boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  checkStatus(paymentId: string): Promise<PaymentStatusResult>;
  /** Verifikasi signature webhook dari raw body + header signature. */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
  /** Normalisasi payload webhook mentah (sudah lolos verifikasi signature). */
  normalizeWebhook(body: Record<string, unknown>): NormalizedWebhook;
}

/** Error provider → ditangani terpusat, pesan ke user selalu generic. */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
