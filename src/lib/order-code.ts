import { randomInt } from "node:crypto";

/**
 * Kode order publik: ORD-YYYYMMDD-XXXXXX
 * (bukan UUID/ID mentah → aman dari enumerasi & mudah dibaca manusia).
 * 6 karakter dari alfabet tanpa karakter membingungkan (0/O, 1/I/L).
 *
 * Tanggal memakai zona WIB (UTC+7, tanpa DST) — sama dengan operasi toko.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

export function generateOrderCode(now: Date = new Date()): string {
  const jakarta = new Date(now.getTime() + JAKARTA_OFFSET_MS);
  const y = jakarta.getUTCFullYear();
  const m = String(jakarta.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jakarta.getUTCDate()).padStart(2, "0");
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `ORD-${y}${m}${d}-${suffix}`;
}

export const ORDER_CODE_REGEX = /^ORD-\d{8}-[A-Z0-9]{6}$/;
