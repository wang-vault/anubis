import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { storeDb } from "@/lib/supabase/server";
import { DeleteProductButton } from "@/components/admin/DeleteProductButton";
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
      <Link href="/admin/products" className="paper-link text-sm font-semibold">
        ← Produk
      </Link>
      <div className="card mt-4 p-6">
        <div className="paper-heading">
          <p className="section-kicker">Kantor redaksi · Koreksi katalog</p>
          <h1 className="paper-heading-title">Edit produk</h1>
          <p className="mt-2 text-xs text-slate-400">
            Perubahan harga TIDAK mengubah order lama (order menyimpan snapshot harga).
          </p>
        </div>
        <div className="mt-5">
          <ProductForm product={data} />
        </div>
        <DeleteProductButton productId={data.id} />
      </div>
    </div>
  );
}
