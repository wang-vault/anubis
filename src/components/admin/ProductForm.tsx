"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  createProductAction,
  updateProductAction,
  type AdminActionState,
} from "@/app/admin/actions";
import type { ProductRow } from "@/lib/types";

/**
 * Form tambah/edit produk (admin). Validasi ulang SELALU terjadi di server
 * action — batas di sini hanya UX.
 */
export function ProductForm({ product }: { product?: ProductRow }) {
  const isEdit = Boolean(product);
  const action = isEdit ? updateProductAction : createProductAction;
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4">
      {isEdit && <input type="hidden" name="id" value={product!.id} />}

      <div>
        <label className="label" htmlFor="p-name">Nama produk</label>
        <input id="p-name" className="input" name="name" required minLength={2} maxLength={120} defaultValue={product?.name} />
      </div>

      <div>
        <label className="label" htmlFor="p-desc">Deskripsi</label>
        <textarea id="p-desc" className="input min-h-28" name="description" maxLength={2000} defaultValue={product?.description ?? ""} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="p-price">Harga (Rupiah)</label>
          <input id="p-price" className="input" name="price" type="number" inputMode="numeric" min={1000} max={100000000} step={1} required defaultValue={product?.price} />
          <p className="hint">Bilangan bulat, mis. 25000 = Rp25.000. Tanpa titik/koma.</p>
        </div>
        <div>
          <label className="label" htmlFor="p-img">URL gambar (https)</label>
          <input id="p-img" className="input" name="image_url" type="url" placeholder="https://..." defaultValue={product?.image_url ?? ""} />
          <p className="hint">Opsional. Upload gambar ke hosting gambarmu, tempel URL-nya.</p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={product ? product.is_active : true}
          className="size-4 accent-emerald-600"
        />
        Aktif — tampil di katalog & bisa dibeli
      </label>

      {state.error && <p role="alert" className="alert-error">{state.error}</p>}

      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending} type="submit">
          {pending ? "Menyimpan…" : isEdit ? "Simpan Perubahan" : "Simpan Produk"}
        </button>
        <Link href="/admin/products" className="btn-secondary">
          Batal
        </Link>
      </div>
    </form>
  );
}
