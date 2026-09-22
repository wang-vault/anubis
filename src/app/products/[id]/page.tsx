import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct } from "@/lib/products";
import { formatRupiah } from "@/lib/money";
import { getAuthContext } from "@/lib/authz";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);
  return { title: product ? product.name : "Produk" };
}

export default async function ProductDetailPage({ params }: Props) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();

  const ctx = await getAuthContext();
  const canBuy = product.is_active;

  return (
    <div className="container-x">
      <Link href="/products" className="paper-link text-sm font-semibold">
        ← Kembali ke katalog
      </Link>

      <div className="card mt-4 grid gap-0 overflow-hidden md:grid-cols-2">
        <div className="product-card-media aspect-square border-b-0 md:border-r md:border-b-0">
          {product.image_url && /^https:\/\//i.test(product.image_url) ? (
            <img
              src={product.image_url}
              alt={product.name}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="product-placeholder" aria-hidden>
              <span className="text-6xl">AN</span>
            </div>
          )}
          <span className="product-card-ribbon">Berita produk</span>
        </div>

        <div className="p-5 sm:p-8">
          <p className="section-kicker">Edisi katalog · Detail</p>
          <h1 className="mt-3 text-3xl font-black leading-none sm:text-4xl">{product.name}</h1>
          <p className="mt-3 font-serif text-2xl font-black text-brand-700">{formatRupiah(product.price)}</p>

          <div className="paper-heading mt-6">
            <p className="paper-heading-kicker">Catatan redaksi</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-600">
              {product.description || "Tidak ada deskripsi untuk produk ini."}
            </p>
          </div>

          <div className="mt-5">
            {canBuy ? (
              <span className="badge bg-emerald-100 text-emerald-800">● Tersedia untuk dipesan</span>
            ) : (
              <span className="badge bg-red-100 text-red-700">✕ Tidak tersedia saat ini</span>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {canBuy ? (
              <Link href={`/checkout?product=${product.id}`} className="btn-primary">
                Beli Sekarang →
              </Link>
            ) : (
              <span className="btn pointer-events-none cursor-not-allowed bg-slate-200 text-slate-400" aria-disabled="true">
                Belum tersedia
              </span>
            )}
            <Link href="/products" className="btn-secondary">
              Lihat produk lain
            </Link>
          </div>
          <p className="hint mt-4">
            Pembayaran manual via WhatsApp: detail pembayaran dikirim penjual di chat, bukti transfer diverifikasi penjual. Pesanan dikirim lewat WhatsApp.
          </p>
          {!ctx && (
            <p className="mt-4 border-t border-dotted border-slate-300 pt-3 text-sm text-slate-500">
              Belum punya akun?{" "}
              <Link href="/auth/register" className="paper-link font-semibold">
                Daftar dulu
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
