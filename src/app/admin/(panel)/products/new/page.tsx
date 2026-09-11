import type { Metadata } from "next";
import Link from "next/link";
import { ProductForm } from "@/components/admin/ProductForm";

export const metadata: Metadata = { title: "Tambah Produk" };

export default function NewProductPage() {
  return (
    <div className="mx-auto max-w-xl">
      <Link href="/admin/products" className="paper-link text-sm font-semibold">
        ← Produk
      </Link>
      <div className="card mt-4 p-6">
        <div className="paper-heading">
          <p className="section-kicker">Kantor redaksi · Berita baru</p>
          <h1 className="paper-heading-title">Tambah produk</h1>
        </div>
        <div className="mt-5">
          <ProductForm />
        </div>
      </div>
    </div>
  );
}
