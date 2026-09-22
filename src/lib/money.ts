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
