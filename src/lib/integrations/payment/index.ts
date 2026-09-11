import "server-only";
import { createYoBasePayProvider } from "./yobasepay";
import type { PaymentProvider } from "./types";

/**
 * Registry provider pembayaran. Ganti provider = buat implementasi baru
 * dari interface PaymentProvider dan kembalikan di sini (lihat types.ts).
 */
let singleton: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!singleton) singleton = createYoBasePayProvider();
  return singleton;
}
