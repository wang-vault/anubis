/**
 * Normalisasi nomor WhatsApp Indonesia.
 * Format yang disimpan/dipakai: digit saja, diawali "62" (contoh: 6281234567890).
 * 08xx / +62xx / 62xx / 8xxx (tanpa 0) → 62xx.
 * Mengembalikan null bila tidak valid.
 */
export function normalizeWhatsapp(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 9) return null;
  let candidate: string;
  if (digits.startsWith("62")) candidate = digits;
  else if (digits.startsWith("0")) candidate = "62" + digits.slice(1);
  else candidate = "62" + digits; // mis. 81234567890
  // 62 + 8..13 digit nomor lokal (rentang realistis nomor Indonesia)
  if (!/^62[2-8][0-9]{7,12}$/.test(candidate)) return null;
  return candidate;
}

/** true bila sudah dalam format final 62xxxxxxxxxxx (hasil validasi registrasi). */
export function isValidWhatsapp(value: string): boolean {
  return /^62[2-8][0-9]{7,12}$/.test(value);
}

/** Link chat wa.me dengan pesan pre-filled. */
export function waMeUrl(phoneDigits: string, text: string): string {
  const clean = phoneDigits.replace(/\D/g, "");
  return `https://wa.me/${clean}?text=${encodeURIComponent(text)}`;
}

/** Tampilan +62 812-3456-7890 (untuk UI). */
export function formatWhatsappDisplay(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (!d.startsWith("62")) return d;
  const rest = d.slice(2);
  return `+62 ${rest.replace(/(\d{3,4})(\d{4})(\d*)/, (_m, a, b, c) =>
    [a, b, c].filter(Boolean).join("-"),
  )}`;
}

/**
 * Pesan template saat penjual membuka chat buyer dari dashboard.
 * Order code disisipkan supaya buyer langsung paham.
 */
export function sellerWaMessage(params: {
  buyerName: string;
  orderCode: string;
  storeName: string;
}): string {
  return (
    `Halo ${params.buyerName || "kak"}, pesananmu ${params.orderCode} di ${params.storeName} ` +
    `sedang kami proses. Balas chat ini untuk konfirmasi / update pengiriman ya. 🙏`
  );
}
