import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Middleware (edge):
 *  1. Menyegarkan cookie session Supabase Auth (wajib untuk @supabase/ssr).
 *  2. Gate rute: /orders, /checkout, /pay → login; /admin → login.
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
    return NextResponse.redirect(loginUrl);
  }

  // Area auth yang sudah login → lempar ke halaman berikutnya / home.
  // Admin login page khusus: user yang sudah login diarahkan ke /admin
  // (role dicek ulang di layout panel).
  if (user && (pathname === "/auth/login" || pathname === "/auth/register")) {
    const next = request.nextUrl.searchParams.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) {
      return NextResponse.redirect(new URL(next, request.url));
    }
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (user && pathname === "/admin/login") {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/orders/:path*",
    "/checkout/:path*",
    "/pay/:path*",
    "/admin/:path*",
    "/auth/login",
    "/auth/register",
  ],
};
