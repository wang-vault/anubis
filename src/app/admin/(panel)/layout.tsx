import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/authz";
import { signOutAction } from "@/app/auth/actions";

export const dynamic = "force-dynamic";

/**
 * Shell dashboard admin. Gate role dilakukan di sini (server-side), dan
 * DIULANG di setiap API route / server action (defense-in-depth) — layout
 * hanya kenyamanan, bukan satu-satunya pagar.
 */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/admin/login");
  if (ctx.profile?.role !== "admin") redirect("/auth/login?error=not_admin");

  const siteName = process.env.NEXT_PUBLIC_SITE_NAME ?? "Toko Saya";

  const tabs = [
    { href: "/admin", label: "Ringkasan" },
    { href: "/admin/orders", label: "Order" },
    { href: "/admin/products", label: "Produk" },
  ];

  return (
    <div className="min-h-[70dvh]">
      <div className="border-b border-slate-200 bg-white">
        <div className="container-x flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
          <span className="text-sm font-extrabold">
            {siteName}
            <span className="ml-2 rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Admin
            </span>
          </span>
          <nav className="flex gap-1 text-sm">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="rounded-lg px-2.5 py-1.5 font-medium text-slate-600 hover:bg-slate-100"
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-slate-400 sm:inline">{ctx.profile.email}</span>
            <form action={signOutAction}>
              <button className="btn-secondary btn-sm">Keluar</button>
            </form>
          </div>
        </div>
      </div>
      <div className="container-x py-6">{children}</div>
    </div>
  );
}
