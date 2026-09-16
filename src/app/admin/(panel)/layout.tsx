import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/authz";
import { signOutAction } from "@/app/auth/actions";
import { ActionButton } from "@/components/ActionButton";
import { SchemaMigrationNotice } from "@/components/admin/SchemaMigrationNotice";
import { checkStoreSchema } from "@/lib/store-schema";

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

  // Kolom pembayaran manual ada di database? Kalau tidak, dashboard tetap
  // tampil (query terkait sudah di-fallback) + banner berisi SQL perbaikannya.
  // Gagal memeriksa (mis. env rusak) tidak boleh menambah kegagalan baru.
  const schema = await checkStoreSchema().catch(() => null);

  const siteName = process.env.NEXT_PUBLIC_SITE_NAME ?? "Toko Saya";

  const tabs = [
    { href: "/admin", label: "Ringkasan" },
    { href: "/admin/orders", label: "Order" },
    { href: "/admin/products", label: "Produk" },
    { href: "/admin/settings", label: "Pembayaran" },
  ];

  return (
    <div className="min-h-[70dvh]">
      <div className="admin-bar">
        <div className="container-x flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <Link href="/admin" className="admin-brand">
            {siteName}
            <span className="admin-pill">Admin desk</span>
          </Link>
          <nav className="flex flex-wrap gap-1" aria-label="Navigasi dashboard">
            {tabs.map((t) => (
              <Link key={t.href} href={t.href} className="admin-nav-link">
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-slate-300 sm:inline">{ctx.profile.email}</span>
            <form action={signOutAction}>
              <ActionButton className="btn-secondary btn-sm" pendingText="Keluar…" type="submit">
                Keluar
              </ActionButton>
            </form>
          </div>
        </div>
      </div>
      <div className="container-x space-y-4 py-6">
        {schema && !schema.ready && <SchemaMigrationNotice check={schema} />}
        {children}
      </div>
    </div>
  );
}
