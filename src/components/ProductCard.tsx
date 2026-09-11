import Link from "next/link";
import { formatRupiah } from "@/lib/money";
import type { ProductRow } from "@/lib/types";

/**
 * Gambar produk dari URL eksternal (diisi owner).
 * <img> biasa + lazy loading native: 0 JS tambahan & tidak bisa gagal
 * karena pembatasan domain optimizer.
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
    <div className="product-placeholder" aria-hidden>
      <span>AN</span>
    </div>
  );
}

export function ProductCard({ product }: { product: ProductRow }) {
  return (
    <Link
      href={`/products/${product.id}`}
      className="card product-card group"
      aria-label={`Lihat detail ${product.name}`}
    >
      <div className="product-card-media">
        <ProductImage src={product.image_url} alt={product.name} />
        <span className="product-card-ribbon">Katalog</span>
      </div>
      <div className="product-card-body">
        <p className="product-card-kicker">Berita produk</p>
        <h3 className="product-card-title line-clamp-2">{product.name}</h3>
        <p className="product-card-price">{formatRupiah(product.price)}</p>
        <div className="product-card-footer">
          <span>{product.is_active ? "Siap dipesan" : "Tidak tersedia"}</span>
          <span className="product-card-arrow" aria-hidden>
            →
          </span>
        </div>
      </div>
    </Link>
  );
}
