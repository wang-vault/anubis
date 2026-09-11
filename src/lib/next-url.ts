/**
 * Parse NEXT_PUBLIC_SITE_URL menjadi `URL` yang valid, dengan fallback aman.
 *
 * `process.env.X ?? default` tidak cukup: variabel bisa TERISI tetapi kosong
 * (mis. `""`), sehingga `new URL("")` melempar `TypeError: Invalid URL`.
 * Helper ini menangani nilai kosong/whitespace maupun nilai yang bukan URL
 * valid, dan TIDAK PERNAH melempar — penting karena dipakai saat `next build`
 * (evaluasi `metadataBase` di root layout) dan di runtime.
 */
export function parseSiteUrl(
  raw: string | null | undefined,
  fallback = "http://localhost:3000",
): URL {
  const candidate = (raw ?? "").trim();
  if (candidate) {
    try {
      return new URL(candidate);
    } catch {
      // bukan URL valid → lanjut ke fallback
    }
  }
  return new URL(fallback);
}

/**
 * Sanitasi parameter `next` (arah redirect setelah login/verifikasi).
 * Hanya path relatif yang diizinkan → cegah open-redirect (mis. //evil.com).
 */
export function sanitizeNextPath(
  raw: string | null | undefined,
  fallback = "/",
): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return fallback;
  }
  if (!/^\/[A-Za-z0-9/_\-.=&?%#]*$/.test(raw)) return fallback;
  return raw;
}
