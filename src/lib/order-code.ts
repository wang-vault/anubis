import { randomInt } from "node:crypto";

/**
 * Kode order publik: ORD-YYYYMMDD-XXXXXX
 * (bukan UUID/ID mentah → aman dari enumerasi & mudah dibaca manusia).
 * 6 karakter dari alfabet tanpa karakter membingungkan (0/O, 1/I/L).
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateOrderCode(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `ORD-${y}${m}${d}-${suffix}`;
}

export const ORDER_CODE_REGEX = /^ORD-\d{8}-[A-Z0-9]{6}$/;
