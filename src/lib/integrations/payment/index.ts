import "server-only";
import { createStenlyProvider } from "./stenly";
import type { PaymentProvider } from "./types";

/**
 * Registry provider pembayaran. Ganti provider = buat implementasi baru
 * dari interface PaymentProvider dan kembalikan di sini (lihat types.ts).
 *
 * Provider aktif: Stenly (StenlyPay) — lihat docs/stenly.md.
 */
let singleton: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!singleton) singleton = createStenlyProvider();
  return singleton;
}

/** Buang singleton (dipakai unit test / setelah env berubah). */
export function resetPaymentProvider(): void {
  singleton = null;
}
