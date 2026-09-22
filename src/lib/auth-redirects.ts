/**
 * Aturan ROUTING halaman auth — murni & edge-safe (tanpa import next/*),
 * dipakai bersama oleh src/middleware.ts (jalur cepat) dan
 * src/lib/auth-guards.ts (defense-in-depth di Server Component).
 *
 * Tujuan: user yang SUDAH LOGIN / SUDAH MENDAFTAR tidak lagi disuguhi
 * halaman daftar / masuk / lupa password:
 *   - Login + email terverifikasi  → redirect ke `next` (sanitasi) atau "/".
 *   - Login + email BELUM verifikasi → redirect ke /auth/verify (halaman yang
 *     memang relevan, bukan form login/daftar lagi).
 *   - Baru mendaftar (belum verifikasi, belum bisa login) → form daftar
 *     diganti redirect ke /auth/verify via cookie penanda (lihat actions.ts).
 *   - /auth/verify untuk user yang sudah terverifikasi → redirect ke "/",
 *     KECUALI datang dari link verifikasi (?verified=1 → layar sukses).
 *   - /admin/login untuk user yang sudah login → langsung /admin
 *     (role tetap dicek ulang di layout panel).
 */
import { sanitizeNextPath } from "@/lib/next-url";

/**
 * Cookie penanda "baru mendaftar, menunggu verifikasi email".
 * - httpOnly, umur pendek (lihat PENDING_REGISTER_MAX_AGE).
 * - Hanya dipakai untuk UX (mengarahkan /auth/register → /auth/verify);
 *   TIDAK untuk otorisasi apa pun.
 */
export const PENDING_REGISTER_COOKIE = "anubis_pending_register";

/** Umur cookie penanda: cukup untuk jendela "daftar lalu cek email", tidak
 *  mengunci form daftar selamanya (bila user memang ingin mendaftar ulang). */
export const PENDING_REGISTER_MAX_AGE = 60 * 60; // 1 jam

/** Halaman yang hanya untuk TAMU (belum login). */
export const GUEST_ONLY_PATHS = [
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
] as const;

export interface AuthRoutingInput {
  /** Path halaman, mis. "/auth/register". */
  pathname: string;
  /** Nilai query ?next= (arah tujuan setelah login) — akan disanitasi. */
  nextParam?: string | null;
  /** true bila query ?verified=1 (baru sukses verifikasi lewat link email). */
  verifiedFlag?: boolean;
  /** Ada session valid (getUser() sukses). */
  authenticated: boolean;
  /** Email user sudah terverifikasi (email_confirmed_at / confirmed_at). */
  emailVerified: boolean;
  /** Cookie penanda baru-mendaftar ada (hanya relevan saat belum login). */
  pendingRegistration: boolean;
}

/**
 * Kembalikan path tujuan redirect BILA halaman tidak boleh ditampilkan,
 * atau null bila boleh lanjut dirender.
 */
export function resolveAuthRedirect(input: AuthRoutingInput): string | null {
  const { pathname, authenticated, emailVerified } = input;

  if (authenticated) {
    // Halaman tamu: tidak ada alasan user login mengisi form ini lagi.
    if ((GUEST_ONLY_PATHS as readonly string[]).includes(pathname)) {
      return emailVerified
        ? sanitizeNextPath(input.nextParam)
        : "/auth/verify?unverified=1";
    }
    // Halaman verifikasi: user terverifikasi tidak perlu "cek email" lagi —
    // kecuali justru baru menyelesaikan verifikasi (?verified=1, layar sukses).
    if (pathname === "/auth/verify") {
      return emailVerified && !input.verifiedFlag
        ? sanitizeNextPath(input.nextParam)
        : null;
    }
    // Login admin: sudah login → langsung dashboard (role dicek ulang di layout).
    if (pathname === "/admin/login") {
      return "/admin";
    }
    return null;
  }

  // Belum login: yang BARU MENDAFTAR tidak perlu melihat form daftar lagi —
  // arahkan ke halaman verifikasi. /auth/login tetap boleh (user mungkin sudah
  // verifikasi dari perangkat lain dan ingin masuk).
  if (pathname === "/auth/register" && input.pendingRegistration) {
    return "/auth/verify";
  }
  return null;
}
