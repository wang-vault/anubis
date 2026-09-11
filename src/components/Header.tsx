import Link from "next/link";
import { getAuthContext, isAdmin } from "@/lib/authz";
import { signOutAction } from "@/app/auth/actions";

/** Header publik (server component — tanpa client JS). */
export async function Header() {
  const ctx = await getAuthContext();
  const siteName = process.env.NEXT_PUBLIC_SITE_NAME ?? "Toko Saya";

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="container-x flex h-14 items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 font-extrabold text-slate-900">
          <span aria-hidden className="grid size-8 place-items-center rounded-xl bg-brand-600 text-white">🛍</span>
          <span className="truncate">{siteName}</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <Link href="/products" className="rounded-lg px-2.5 py-1.5 font-medium text-slate-600 hover:bg-slate-100">
            Produk
          </Link>
          {ctx ? (
            <>
              <Link href="/orders" className="rounded-lg px-2.5 py-1.5 font-medium text-slate-600 hover:bg-slate-100">
                Pesanan Saya
              </Link>
              {isAdmin(ctx) && (
                <Link href="/admin" className="rounded-lg px-2.5 py-1.5 font-medium text-brand-700 hover:bg-brand-50">
                  Dashboard
                </Link>
              )}
              <span className="hidden px-2 text-slate-400 sm:inline">·</span>
              <span className="hidden max-w-32 truncate px-1 font-medium text-slate-700 sm:inline">
                {ctx.profile?.name ?? "Akun"}
              </span>
              <form action={signOutAction}>
                <button type="submit" className="btn-secondary btn-sm" aria-label="Keluar dari akun">
                  Keluar
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="btn-secondary btn-sm">
                Masuk
              </Link>
              <Link href="/auth/register" className="btn-primary btn-sm">
                Daftar
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
