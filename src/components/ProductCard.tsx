import Link from "next/link";
import { formatRupiah } from "@/lib/money";
import type { ProductRow } from "@/lib/types";

/**
 * Gambar produk dari URL eksternal (diisi owner).
 * <img> biasa + lazy loading native: 0 JS tambahan & tidak bisa gagal
 * karena pembatasan domain optimizer. Owner disarankan mengunggah gambar
 * ke hosting dengan https + rasio 4:3.
 */
function ProductImage({ src, alt }: { src: string | null; alt: string }) {
  if (src && /^https:\/\//i.test(src)) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div className="grid h-full w-full place-items-center bg-slate-100 text-3xl" aria-hidden>
      📦
    </div>
  );
}

export function ProductCard({ product }: { product: ProductRow }) {
  return (
    <Link
      href={`/products/${product.id}`}
      className="card group overflow-hidden transition hover:border-brand-600"
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100">
        <ProductImage src={product.image_url} alt={product.name} />
      </div>
      <div className="p-3.5">
        <h3 className="line-clamp-1 text-sm font-semibold text-slate-900">{product.name}</h3>
        <p className="mt-1 text-base font-bold text-brand-700">{formatRupiah(product.price)}</p>
        {!product.is_active && (
          <p className="mt-1 text-xs font-medium text-red-600">Tidak tersedia</p>
        )}
      </div>
    </Link>
  );
}
