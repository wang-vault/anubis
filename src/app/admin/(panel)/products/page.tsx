import type { Metadata } from "next";
import Link from "next/link";
import { adminListProducts } from "@/lib/products";
import { formatRupiah } from "@/lib/money";
import { toggleProductAction } from "@/app/admin/actions";

export const metadata: Metadata = { title: "Produk — Admin" };

interface Props {
  searchParams: Promise<{ created?: string; saved?: string }>;
}

export default async function AdminProductsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const products = await adminListProducts();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Produk</h1>
          <p className="text-sm text-slate-500">{products.length} produk di katalog toko.</p>
        </div>
        <Link href="/admin/products/new" className="btn-primary">
          + Tambah Produk
        </Link>
      </div>

      {sp.created === "1" && <p className="alert-info">✅ Produk berhasil dibuat.</p>}
      {sp.saved === "1" && <p className="alert-info">✅ Perubahan produk tersimpan.</p>}

      {products.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500">
          Belum ada produk. Tambahkan produk pertama lewat tombol di atas.
        </div>
      ) : (
        <div className="space-y-2.5">
          {products.map((p) => (
            <div key={p.id} className="card flex flex-wrap items-center gap-3 p-3">
              <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                {p.image_url && /^https:\/\//i.test(p.image_url) ? (
                  
                  <img src={p.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-lg">📦</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{p.name}</p>
                <p className="text-sm font-bold text-brand-700">{formatRupiah(p.price)}</p>
              </div>
              <span
                className={`badge ${p.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}
              >
                {p.is_active ? "Aktif" : "Nonaktif"}
              </span>
              <div className="flex gap-2">
                <Link href={`/admin/products/${p.id}`} className="btn-secondary btn-sm">
                  Edit
                </Link>
                <form action={toggleProductAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="active" value={p.is_active ? "false" : "true"} />
                  <input type="hidden" name="back" value="/admin/products" />
                  <button className="btn-secondary btn-sm" type="submit">
                    {p.is_active ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
