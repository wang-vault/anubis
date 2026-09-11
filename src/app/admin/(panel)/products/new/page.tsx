import type { Metadata } from "next";
import Link from "next/link";
import { ProductForm } from "@/components/admin/ProductForm";

export const metadata: Metadata = { title: "Tambah Produk" };

export default function NewProductPage() {
  return (
    <div className="mx-auto max-w-xl">
      <Link href="/admin/products" className="text-sm text-slate-500 hover:underline">
        ← Produk
      </Link>
      <div className="card mt-3 p-6">
        <h1 className="text-xl font-bold">Tambah Produk</h1>
        <div className="mt-5">
          <ProductForm />
        </div>
      </div>
    </div>
  );
}
