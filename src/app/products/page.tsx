import type { Metadata } from "next";
import Link from "next/link";
import { listActiveProducts } from "@/lib/products";
import { applyProductSearch, normalizeSearchTerm } from "@/lib/product-search";
import { ProductCard } from "@/components/ProductCard";
import { SearchBox } from "@/components/SearchBox";
import { EmptyState } from "@/components/UiBits";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const term = normalizeSearchTerm((await searchParams).q);
  if (!term) return { title: "Daftar Produk" };
  // Halaman hasil pencarian tidak diindeks (jumlahnya tak terbatas & tanpa nilai SEO).
  return { title: `Cari “${term}”`, robots: { index: false, follow: true } };
}

export default async function ProductsPage({ searchParams }: Props) {
  const sp = await searchParams;
  // Filter di memori atas katalog yang sudah dibaca server-side (maks. 200
  // produk aktif) — tanpa query tambahan, tanpa index database baru.
  const { search, products, total, matchCount } = applyProductSearch(
    await listActiveProducts(),
    sp.q,
  );

  return (
    <div className="container-x">
      <div className="catalog-intro">
        <div>
          <p className="section-kicker">Lembar katalog · Belanja pilihan</p>
          <h1 className="catalog-title">Semua produk</h1>
        </div>
        <p className="catalog-deck">
          Harga sudah termasuk pajak toko. Temukan barang yang sedang jadi berita utama, lalu selesaikan transaksi setelah checkout: transfer manual via WhatsApp.
        </p>
      </div>

      <div className="search-row">
        <SearchBox
          action="/products"
          id="catalog-search"
          label="Cari produk"
          placeholder="Cari produk, mis. kopi"
          defaultValue={search.term}
          clearHref="/products"
          className="w-full sm:max-w-md"
        />
        <p className="search-count">
          {search.active ? (
            <>
              <strong>{matchCount}</strong> dari {total} produk cocok dengan{" "}
              <strong>“{search.term}”</strong>.
            </>
          ) : (
            <>{total} produk siap dipesan.</>
          )}
        </p>
      </div>

      <div className="mt-6">
        {products.length === 0 ? (
          // Katalog kosong tidak perlu pesan "hasil tidak ditemukan": tidak ada
          // apa pun untuk dicari. Pesan pencarian hanya bila katalog memang ada isinya.
          total > 0 && search.active ? (
            <EmptyState
              icon="?"
              title={`Tidak ada produk untuk “${search.term}”`}
              desc="Coba kata kunci lain atau yang lebih pendek — pencarian memeriksa nama, deskripsi, dan harga produk."
              action={
                <Link href="/products" className="btn-secondary">
                  Hapus pencarian
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon="AN"
              title="Produk belum tersedia"
              desc="Cek kembali nanti — penjual sedang menyiapkan katalog baru."
            />
          )
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} search={search} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
