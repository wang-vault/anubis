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
      <h1 className="text-xl font-bold">Semua Produk</h1>
      <p className="mt-1 text-sm text-slate-500">
        Harga sudah termasuk pajak toko. Bayar dengan QRIS setelah checkout.
      </p>
      <div className="mt-5">
        {products.length === 0 ? (
          <EmptyState
            icon="🛒"
            title="Produk belum tersedia"
            desc="Cek kembali nanti — penjual sedang menyiapkan katalog."
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
