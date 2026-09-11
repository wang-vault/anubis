import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { storeDb } from "@/lib/supabase/server";
import { ProductForm } from "@/components/admin/ProductForm";
import type { ProductRow } from "@/lib/types";

export const metadata: Metadata = { title: "Edit Produk" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: Props) {
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) notFound();

  const db = await storeDb();
  const { data } = await db
    .from("products")
    .select("id,name,description,price,image_url,is_active,created_at,updated_at")
    .eq("id", id)
    .maybeSingle<ProductRow>();
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-xl">
      <Link href="/admin/products" className="text-sm text-slate-500 hover:underline">
        ← Produk
      </Link>
      <div className="card mt-3 p-6">
        <h1 className="text-xl font-bold">Edit Produk</h1>
        <p className="mt-1 text-xs text-slate-400">
          Perubahan harga TIDAK mengubah order lama (order menyimpan snapshot harga).
        </p>
        <div className="mt-5">
          <ProductForm product={data} />
        </div>
      </div>
    </div>
  );
}
