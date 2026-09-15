import type { Metadata } from "next";
import { listActiveProducts } from "@/lib/products";
import { ProductCard } from "@/components/ProductCard";
import { EmptyState } from "@/components/UiBits";

export const metadata: Metadata = { title: "Daftar Produk" };
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const products = await listActiveProducts();

  return (
    <div className="container-x">
      <div className="catalog-intro">
        <div>
          <p className="section-kicker">Lembar katalog · Belanja pilihan</p>
          <h1 className="catalog-title">Semua produk</h1>
        </div>
        <p className="catalog-deck">
          Harga sudah termasuk pajak toko. Temukan barang yang sedang jadi berita utama, lalu selesaikan transaksi dengan transfer manual (opsi QRIS status ongoing) setelah checkout.
        </p>
      </div>
      <div className="mt-6">
        {products.length === 0 ? (
          <EmptyState
            icon="AN"
            title="Produk belum tersedia"
            desc="Cek kembali nanti — penjual sedang menyiapkan katalog baru."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
