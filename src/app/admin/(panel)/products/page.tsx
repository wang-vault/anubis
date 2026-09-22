import type { Metadata } from "next";
import Link from "next/link";
import { adminListProducts } from "@/lib/products";
import { applyProductSearch, descriptionSnippet } from "@/lib/product-search";
import { formatRupiah } from "@/lib/money";
import { toggleProductAction } from "@/app/admin/actions";
import { ActionButton } from "@/components/ActionButton";
import { SearchBox } from "@/components/SearchBox";
import { HighlightText } from "@/components/HighlightText";

export const metadata: Metadata = { title: "Produk — Admin" };

interface Props {
  searchParams: Promise<{ created?: string; saved?: string; q?: string }>;
}

export default async function AdminProductsPage({ searchParams }: Props) {
  const sp = await searchParams;
  // Penjual melihat semua produk (termasuk nonaktif), lalu difilter di memori
  // dengan mesin pencarian yang sama seperti katalog publik.
  const { search, products, total, matchCount } = applyProductSearch(
    await adminListProducts(),
    sp.q,
  );
  const tokens = search.active ? search.tokens : [];

  return (
    <div className="space-y-4">
      <div className="paper-heading flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-kicker">Kantor redaksi · Katalog</p>
          <h1 className="paper-heading-title">Kelola produk</h1>
          <p className="mt-2 text-sm text-slate-500">
            {search.active ? (
              <>
                <strong>{matchCount}</strong> dari {total} produk cocok dengan{" "}
                <strong>“{search.term}”</strong>.
              </>
            ) : (
              <>{total} produk di katalog toko.</>
            )}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <SearchBox
            action="/admin/products"
            id="admin-product-search"
            label="Cari produk"
            placeholder="Nama / deskripsi / harga"
            defaultValue={search.term}
            clearHref="/admin/products"
            className="w-full sm:w-72"
          />
          <Link href="/admin/products/new" className="btn-primary shrink-0">
            + Tambah Produk
          </Link>
        </div>
      </div>

      {sp.created === "1" && <p className="alert-info">✅ Produk berhasil dibuat.</p>}
      {sp.saved === "1" && <p className="alert-info">✅ Perubahan produk tersimpan.</p>}

      {products.length === 0 ? (
        // Katalog masih kosong → ajakan menambah produk (bukan pesan pencarian).
        total > 0 && search.active ? (
          <div className="paper-empty p-10 text-center text-sm text-slate-500">
            <p className="font-bold text-slate-700">Tidak ada produk yang cocok dengan “{search.term}”.</p>
            <p className="mt-1">Coba kata kunci lain — nama, deskripsi, dan harga ikut dicari.</p>
            <Link href="/admin/products" className="paper-link mt-3 inline-block font-bold">
              Hapus pencarian
            </Link>
          </div>
        ) : (
          <div className="paper-empty p-10 text-center text-sm text-slate-500">
            Belum ada produk. Tambahkan produk pertama lewat tombol di atas.
          </div>
        )
      ) : (
        <div className="space-y-2.5">
          {products.map((p) => {
            // Saat mencari: potongan deskripsi di sekitar kecocokan supaya
            // terlihat kenapa produk ini ikut tampil (dipotong juga oleh CSS).
            const snippet = tokens.length > 0 ? descriptionSnippet(p.description, tokens, 180) : null;
            return (
              <div key={p.id} className="card flex flex-wrap items-center gap-3 p-3 sm:p-4">
                <div className="product-placeholder size-14 shrink-0 text-sm">
                  {p.image_url && /^https:\/\//i.test(p.image_url) ? (
                    <img src={p.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span>AN</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-serif text-base font-black">
                    <HighlightText text={p.name} tokens={tokens} />
                  </p>
                  <p className="font-serif text-sm font-bold text-brand-700">{formatRupiah(p.price)}</p>
                  {snippet && (
                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-500">
                      <HighlightText text={snippet} tokens={tokens} />
                    </p>
                  )}
                </div>
                <span
                  className={`badge ${p.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}
                >
                  {p.is_active ? "Aktif" : "Nonaktif"}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/admin/products/${p.id}`} className="btn-secondary btn-sm">
                    Edit
                  </Link>
                  <form action={toggleProductAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="active" value={p.is_active ? "false" : "true"} />
                    {/* Kembali ke daftar dengan kata kunci yang sama (hasil tidak hilang). */}
                    <input
                      type="hidden"
                      name="back"
                      value={search.term ? `/admin/products?q=${encodeURIComponent(search.term)}` : "/admin/products"}
                    />
                    <ActionButton className="btn-secondary btn-sm" type="submit" pendingText="Mengubah…">
                      {p.is_active ? "Nonaktifkan" : "Aktifkan"}
                    </ActionButton>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
