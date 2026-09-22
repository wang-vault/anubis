/**
 * ===========================================================================
 * PESAN WHATSAPP PEMBAYARAN — modul murni (tanpa I/O, tanpa server-only).
 * ===========================================================================
 * Semua koordinasi pembayaran terjadi di WhatsApp: buyer membuka chat ke
 * penjual dengan pesan yang SUDAH terisi kode order, produk, dan nominal.
 * Tujuannya: penjual tidak perlu bertanya balik, dan buyer tidak salah order.
 *
 * Template bisa diubah penjual dari /admin/settings (kolom
 * `manual_payment_settings.whatsapp_message_template`). Placeholder yang
 * dikenali ditulis dengan kurung kurawal, mis. {kode}, {total}.
 */
import { formatRupiah } from "@/lib/money";
import { waMeUrl } from "@/lib/phone";

/** Variabel yang boleh dipakai di template pesan. */
export interface PaymentMessageVars {
  storeName: string;
  buyerName: string;
  orderCode: string;
  productName: string;
  quantity: number;
  /** Nominal final yang harus dibayar (total + kode unik). */
  amount: number;
}

/**
 * Template default pesan buyer → penjual. Sengaja memuat SEMUA informasi yang
 * dibutuhkan penjual untuk memproses, dan TIDAK memuat detail rekening (itu
 * penjual yang mengirim, agar nomornya selalu terbaru).
 */
export const DEFAULT_PAYMENT_MESSAGE_TEMPLATE = [
  "Halo {toko}, saya mau bayar pesanan saya:",
  "",
  "Kode order : {kode}",
  "Produk     : {produk} × {jumlah}",
  "Total      : {total}",
  "Nama       : {nama}",
  "",
  "Mohon dikirim detail pembayarannya (QRIS / rekening / e-wallet). Terima kasih.",
].join("\n");

/** Daftar placeholder + artinya — dipakai UI admin sebagai petunjuk. */
export const PAYMENT_MESSAGE_PLACEHOLDERS = [
  { token: "{toko}", desc: "nama toko" },
  { token: "{kode}", desc: "kode order (ORD-…)" },
  { token: "{produk}", desc: "nama produk" },
  { token: "{jumlah}", desc: "jumlah pcs" },
  { token: "{total}", desc: "nominal transfer (Rp…)" },
  { token: "{nama}", desc: "nama buyer" },
] as const;

/**
 * Isi template dengan nilai order. Placeholder yang tidak dikenal dibiarkan
 * apa adanya (tidak pernah membuang teks penjual), dan template kosong jatuh
 * ke template default.
 */
export function renderPaymentMessage(
  template: string | null | undefined,
  vars: PaymentMessageVars,
): string {
  const source = template?.trim() ? template : DEFAULT_PAYMENT_MESSAGE_TEMPLATE;
  const map: Record<string, string> = {
    "{toko}": vars.storeName || "toko",
    "{kode}": vars.orderCode,
    "{produk}": vars.productName,
    "{jumlah}": String(vars.quantity),
    "{total}": formatRupiah(vars.amount),
    "{nama}": vars.buyerName || "buyer",
  };
  return source.replace(/\{toko\}|\{kode\}|\{produk\}|\{jumlah\}|\{total\}|\{nama\}/g, (m) => map[m] ?? m);
}

/**
 * Link `wa.me` yang membuka chat penjual dengan pesan pembayaran siap kirim.
 * Nomor wajib sudah ternormalisasi (62…) — lihat lib/phone.normalizeWhatsapp.
 */
export function paymentWhatsappUrl(
  sellerNumber: string,
  vars: PaymentMessageVars,
  template?: string | null,
): string {
  return waMeUrl(sellerNumber, renderPaymentMessage(template, vars));
}

/**
 * Pesan singkat buyer → penjual setelah buyer mengaku sudah transfer.
 * Dipakai sebagai fallback bila buyer membuka WhatsApp lagi dari halaman
 * "menunggu verifikasi" (mis. mau mengirim bukti transfer).
 */
export function transferProofMessage(vars: {
  orderCode: string;
  amount: number;
  buyerName: string;
}): string {
  return [
    `Halo, saya sudah transfer untuk pesanan ${vars.orderCode}.`,
    `Nominal: ${formatRupiah(vars.amount)}`,
    `Nama pengirim: ${vars.buyerName || "-"}`,
    "",
    "Saya lampirkan bukti transfernya di chat ini ya. Terima kasih.",
  ].join("\n");
}
