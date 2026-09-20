/** Uang dalam Rupiah penuh (integer, tanpa sen) — sama dengan DB store. */
const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/**
 * Format deterministik "Rp25.000" — sengaja tidak memakai style:'currency'
 * karena Intl menambahkan spasi tipis antar-ICU/versi browser.
 */
export function formatRupiah(amount: number | string): string {
  const n = typeof amount === "string" ? Number.parseInt(amount, 10) : amount;
  return `Rp${number.format(Number.isFinite(n) ? n : 0)}`;
}

/**
 * Validasi nominal webhook/status terhadap nominal order.
 *
 * Stenly menagih nominal PERSIS seperti yang dikirim saat create charge
 * (`gross_amount`), jadi toleransi yang dipakai untuk QRIS otomatis = 0.
 * Parameter `tolerance` tetap ada karena pembayaran MANUAL memakai kode unik
 * (total + 1..999) agar mutasi mudah dicocokkan penjual.
 */
export function amountWithinTolerance(
  charged: number,
  orderTotal: number,
  tolerance: number,
): boolean {
  return (
    Number.isFinite(charged) &&
    charged >= orderTotal &&
    charged <= orderTotal + tolerance
  );
}
