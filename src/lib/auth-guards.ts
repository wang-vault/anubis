import "server-only";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { accountServer } from "@/lib/supabase/server";
import {
  PENDING_REGISTER_COOKIE,
  resolveAuthRedirect,
} from "@/lib/auth-redirects";

/**
 * Guard SERVER-SIDE untuk halaman auth (defense-in-depth).
 *
 * Middleware (src/middleware.ts) normalnya sudah me-redirect sebelum halaman
 * dirender; guard ini MENGULANG aturan yang sama persis di Server Component —
 * pola yang dipakai repo ini untuk /admin (middleware + layout panel) —
 * sehingga halaman tetap benar bila matcher middleware berubah/terlewat.
 *
 * Dipanggil paling atas Server Component halaman auth:
 *   await guardAuthPage({ pathname: "/auth/login", nextParam: next });
 */
export async function guardAuthPage(opts: {
  pathname: string;
  nextParam?: string | null;
  verifiedFlag?: boolean;
}): Promise<void> {
  const supabase = await accountServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const jar = await cookies();
  const target = resolveAuthRedirect({
    pathname: opts.pathname,
    nextParam: opts.nextParam,
    verifiedFlag: opts.verifiedFlag,
    authenticated: Boolean(user),
    emailVerified: Boolean(user && (user.email_confirmed_at ?? user.confirmed_at)),
    pendingRegistration: jar.has(PENDING_REGISTER_COOKIE),
  });
  if (target) redirect(target);
}
