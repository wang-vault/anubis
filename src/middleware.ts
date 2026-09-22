import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  PENDING_REGISTER_COOKIE,
  resolveAuthRedirect,
} from "@/lib/auth-redirects";

/**
 * Middleware (edge):
 *  1. Menyegarkan cookie session Supabase Auth (wajib untuk @supabase/ssr).
 *  2. Gate rute: /orders, /checkout, /pay → login; /admin → login.
 *  3. Halaman auth hanya untuk TAMU:
 *     - Sudah login (terverifikasi) → /auth/login, /auth/register,
 *       /auth/forgot-password diarahkan ke ?next= atau "/",
 *       /auth/verify diarahkan ke "/" (kecuali ?verified=1 = layar sukses),
 *       /admin/login diarahkan ke /admin.
 *     - Sudah login tapi belum verifikasi → diarahkan ke /auth/verify.
 *     - BARU MENDAFTAR (belum verifikasi, belum bisa login) → /auth/register
 *       diarahkan ke /auth/verify lewat cookie penanda (lihat auth/actions.ts).
 *     Aturan ini disatukan di src/lib/auth-redirects.ts dan DIULANG di setiap
 *     halaman auth (src/lib/auth-guards.ts) — pola defense-in-depth yang sama
 *     dengan /admin (layout panel).
 *     CATATAN: middleware hanya mengecek ADA session. Verifikasi email,
 *     role admin, dan kepemilikan data SELALU ditegakkan ulang di
 *     server action / API route (requireVerifiedUser / requireAdmin).
 */
const PROTECTED_BUYER = ["/orders", "/checkout", "/pay"];
const PROTECTED_ADMIN = ["/admin"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isBuyerArea = PROTECTED_BUYER.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isAdminArea =
    PROTECTED_ADMIN.some((p) => pathname === p || pathname.startsWith(p + "/")) &&
    !pathname.startsWith("/admin/login");

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_ACCOUNT_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ACCOUNT_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: getUser() memverifikasi token ke Supabase (bukan hanya decode).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && (isBuyerArea || isAdminArea)) {
    const loginUrl = new URL(isAdminArea ? "/admin/login" : "/auth/login", request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return redirectPreservingSession(request, response, loginUrl);
  }

  const authRedirect = resolveAuthRedirect({
    pathname,
    nextParam: request.nextUrl.searchParams.get("next"),
    verifiedFlag: request.nextUrl.searchParams.get("verified") === "1",
    authenticated: Boolean(user),
    emailVerified: Boolean(user && (user.email_confirmed_at ?? user.confirmed_at)),
    pendingRegistration: request.cookies.has(PENDING_REGISTER_COOKIE),
  });
  if (authRedirect) {
    return redirectPreservingSession(request, response, new URL(authRedirect, request.url));
  }

  return response;
}

/**
 * Redirect yang MEMBAWA cookie session hasil rotasi getUser().
 *
 * getUser() di middleware dapat memutar token Supabase; cookie baru tertulis
 * di `response`. Bila redirect dikembalikan polos, cookie itu hilang — browser
 * menyimpan refresh token LAMA yang sudah dirotasi, sehingga permintaan
 * berikutnya getUser() gagal dan user yang sebenarnya login terlihat
 * "logout" (disuguhi halaman daftar/masuk lagi).
 */
function redirectPreservingSession(
  _request: NextRequest,
  response: NextResponse,
  location: URL,
): NextResponse {
  const redirect = NextResponse.redirect(location);
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export const config = {
  matcher: [
    "/orders/:path*",
    "/checkout/:path*",
    "/pay/:path*",
    "/admin/:path*",
    "/auth/login",
    "/auth/register",
    "/auth/forgot-password",
    "/auth/verify",
  ],
};
