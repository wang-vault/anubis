/**
 * Helper untuk server action: `redirect()` / `notFound()` di Next.js
 * melempar exception khusus. Catch generik HARUS melempar ulang supaya
 * navigasi tidak berubah jadi pesan error palsu ke user.
 */
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { isHTTPAccessFallbackError } from "next/dist/client/components/http-access-fallback/http-access-fallback";

/** Lempar ulang control-flow Next (redirect, notFound, dll). */
export function rethrowNextControlFlow(err: unknown): void {
  if (isRedirectError(err)) throw err;
  if (isHTTPAccessFallbackError(err)) throw err;
}
