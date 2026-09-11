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
 * Validasi nominal webhook terhadap nominal order.
 * YoBasePay (V1/V2) menambahkan kode unik +1..99 / +100..999 ke nominal agar
 * mudah dicocokkan dari mutasi, jadi jumlah yang dibayar = total + kode unik.
 * V3 (no unique code) = nominal pas → set YOBASEPAY_AMOUNT_TOLERANCE=0.
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
