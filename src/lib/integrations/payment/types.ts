/**
 * Kontrak PaymentProvider — abstraction layer pembayaran.
 *
 * Implementasi aktif: YoBasePay (Payment Engine QRIS). Untuk mengganti
 * provider di masa depan, cukup buat implementasi interface ini dan
 * daftarkan di ./index.ts — kode bisnis (orders.ts, webhook) tidak berubah.
 */

export interface CreatePaymentInput {
  /** Nominal dalam Rupiah (integer). Provider boleh menambah kode unik. */
  amount: number;
  /** Kode order kita (ORD-YYYYMMDD-XXXXXX) — dipakai utk pelacakan internal. */
  orderCode: string;
  description?: string;
}

export interface CreatedPayment {
  /** ID transaksi dari provider (YoBasePay: trx_id, mis. "YO-ABC12345"). */
  paymentId: string;
  paymentUrl: string | null;
  /**
   * Sumber gambar QR siap render: URL https absolut ATAU `data:image/…;base64`.
   * Adapter sudah menormalisasi URL relatif/protocol-relative milik provider,
   * jadi nilai di sini selalu lolos `isRenderableQrSrc()` bila tidak null.
   */
  qrImageUrl: string | null;
  /**
   * Payload QRIS mentah (string EMVCo/BRCode) bila provider TIDAK mengirim
   * gambar. Berguna untuk diagnostik & (opsional) dirender sendiri lewat
   * `YOBASEPAY_QR_RENDER_URL`. Null bila provider mengirim gambar.
   */
  qrPayload?: string | null;
  /** ISO string, boleh null bila provider tidak memberi. */
  expiresAt: string | null;
  /**
   * Nominal yang diminta provider (bisa total + kode unik YoBasePay).
   * null bila provider tidak mengembalikan amount di createpayment.
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
