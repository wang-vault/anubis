import { NextResponse, type NextRequest } from "next/server";
import { accountServer } from "@/lib/supabase/server";
import { log } from "@/lib/logger";
import { serverEnv } from "@/lib/env";
import { sanitizeNextPath } from "@/lib/next-url";
import { PENDING_REGISTER_COOKIE } from "@/lib/auth-redirects";

export const dynamic = "force-dynamic";

/**
 * GET /auth/callback
 * Titik masuk SEMUA link email Supabase (verifikasi email & reset password).
 *
 * Mendukung 2 varian link (agar cocok dengan template email default maupun
 * template token_hash yang direkomendasikan docs/supabase-account.md):
 *   1. PKCE:   /auth/callback?code=...           → exchangeCodeForSession
 *   2. Email:  /auth/callback?token_hash=..&type=email|recovery → verifyOtp
 *
 * Setelah sukses → redirect ke ?next= yang sudah disanitasi.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = sanitizeNextPath(url.searchParams.get("next"), "/auth/verify");

  const supabase = await accountServer();

  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      return redirectWithWelcome(next, url);
    }
    if (tokenHash && (type === "email" || type === "recovery")) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type === "email" ? "email" : "recovery",
      });
      if (error) throw error;
      return redirectWithWelcome(next, url);
    }
  } catch (err) {
    log.warn("auth_callback_failed", { message: err instanceof Error ? err.message : "unknown" });
  }

  return NextResponse.redirect(
    new URL("/auth/login?error=verify_failed", serverEnv().NEXT_PUBLIC_SITE_URL),
  );
}

function redirectWithWelcome(next: string, url: URL): NextResponse {
  // Tandai keberhasilan supaya halaman tujuan menampilkan pesan yang tepat.
  const target = new URL(next, serverEnv().NEXT_PUBLIC_SITE_URL);
  if (url.searchParams.get("type") === "recovery") {
    target.searchParams.set("recovered", "1");
  } else {
    target.searchParams.set("verified", "1");
  }
  const res = NextResponse.redirect(target);
  // Verifikasi/recovery sukses → hapus penanda "baru mendaftar" bila ada.
  res.cookies.delete(PENDING_REGISTER_COOKIE);
  return res;
}
