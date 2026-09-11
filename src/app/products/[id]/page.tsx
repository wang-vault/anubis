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
      <Link href="/products" className="text-sm text-slate-500 hover:underline">
        ← Semua produk
      </Link>

      <div className="card mt-3 grid gap-0 overflow-hidden md:grid-cols-2">
        <div className="aspect-square bg-slate-100">
          {product.image_url && /^https:\/\//i.test(product.image_url) ? (
            
            <img
              src={product.image_url}
              alt={product.name}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-6xl" aria-hidden>
              📦
            </div>
          )}
        </div>

        <div className="p-5 sm:p-8">
          <h1 className="text-2xl font-bold">{product.name}</h1>
          <p className="mt-2 text-2xl font-extrabold text-brand-700">{formatRupiah(product.price)}</p>

          <p className="mt-4 whitespace-pre-line text-sm leading-6 text-slate-600">
            {product.description || "Tidak ada deskripsi."}
          </p>

          <div className="mt-4">
            {canBuy ? (
              <span className="badge bg-emerald-100 text-emerald-800">● Tersedia</span>
            ) : (
              <span className="badge bg-red-100 text-red-700">✕ Tidak tersedia saat ini</span>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={canBuy ? `/checkout?product=${product.id}` : "#"}
              aria-disabled={!canBuy}
              className={
                canBuy
                  ? "btn-primary"
                  : "btn pointer-events-none bg-slate-200 text-slate-400"
              }
            >
              Beli Sekarang
            </Link>
          </div>
          <p className="hint mt-3">
            Pembayaran via QRIS, verifikasi otomatis. Pesanan dikirim penjual lewat WhatsApp.
          </p>
          {!ctx && (
            <p className="mt-3 text-sm text-slate-500">
              Belum punya akun?{" "}
              <Link href="/auth/register" className="text-brand-700 hover:underline">
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
