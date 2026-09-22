import Link from "next/link";
import { formatRupiah } from "@/lib/money";
import { descriptionSnippet, type ProductSearchState } from "@/lib/product-search";
import { HighlightText } from "@/components/HighlightText";
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

export function ProductCard({
  product,
  search,
}: {
  product: ProductRow;
  /** Keadaan pencarian halaman; bila aktif, judul disorot & deskripsi ringkas tampil. */
  search?: ProductSearchState | null;
}) {
  const tokens = search?.active ? search.tokens : [];
  const snippet = tokens.length > 0 ? descriptionSnippet(product.description, tokens) : null;

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
        <p className="product-card-kicker">{tokens.length > 0 ? "Hasil pencarian" : "Berita produk"}</p>
        <h3 className="product-card-title line-clamp-2">
          <HighlightText text={product.name} tokens={tokens} />
        </h3>
        {snippet && (
          <p className="product-card-snippet line-clamp-3">
            <HighlightText text={snippet} tokens={tokens} />
          </p>
        )}
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
