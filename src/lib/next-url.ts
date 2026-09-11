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
