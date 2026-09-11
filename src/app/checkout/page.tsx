import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/authz";
import { getProduct } from "@/lib/products";
import { CheckoutForm } from "@/app/checkout/CheckoutForm";
import { EmptyState } from "@/components/UiBits";

export const metadata: Metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ product?: string; error?: string }>;
}

export default async function CheckoutPage({ searchParams }: Props) {
  const { product: productId } = await searchParams;
  const ctx = await getAuthContext();

  if (!ctx) {
    const next = encodeURIComponent(`/checkout${productId ? `?product=${productId}` : ""}`);
    redirect(`/auth/login?next=${next}`);
  }
  if (!ctx.emailVerified) {
    redirect("/auth/verify?unverified=1");
  }
  if (!ctx.profile) {
    redirect("/auth/verify");
  }
  if (!productId) {
    return (
      <div className="container-x mx-auto max-w-lg">
        <EmptyState
          icon="?"
          title="Produk belum dipilih"
          desc="Pilih produk dari katalog untuk melanjutkan checkout."
          action={
            <Link href="/products" className="btn-primary">
              Lihat Katalog →
            </Link>
          }
        />
      </div>
    );
  }

  const product = await getProduct(productId);
  if (!product || !product.is_active) {
    return (
      <div className="container-x mx-auto max-w-lg">
        <EmptyState
          icon="!"
          title="Produk tidak tersedia"
          desc="Produk ini sudah habis / dinonaktifkan penjual. Silakan pilih produk lain."
          action={
            <Link href="/products" className="btn-primary">
              Kembali ke Katalog →
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="container-x mx-auto max-w-lg">
      <div className="paper-heading">
        <p className="section-kicker">Halaman pesanan · Edisi checkout</p>
        <h1 className="paper-heading-title">Siapkan pesananmu</h1>
        <p className="mt-2 text-sm text-slate-500">
          Pemesan: <strong>{ctx.profile.name}</strong> · {ctx.user.email}
        </p>
      </div>
      <div className="mt-5">
        <CheckoutForm
          productId={product.id}
          productName={product.name}
          unitPrice={product.price}
          whatsapp={ctx.profile.whatsapp}
        />
      </div>
    </div>
  );
}
