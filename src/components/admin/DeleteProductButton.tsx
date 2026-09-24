"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const BLOCKED_MESSAGE = "Produk tidak bisa dihapus karena masih ada pesanan aktif.";

/**
 * Hapus permanen dari halaman edit. Konfirmasi browser, lalu DELETE
 * /api/admin/products/{id}. Sukses → daftar produk. 409 (pesanan aktif)
 * ditampilkan di tempat, form edit tidak ikut ter-submit.
 */
export function DeleteProductButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onDelete() {
    if (pending) return;
    if (!window.confirm("Yakin hapus produk ini? Tindakan tidak bisa dibatalkan.")) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/${encodeURIComponent(productId)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as {
        deleted?: boolean;
        error?: { message?: string };
      } | null;
      if (res.ok && body?.deleted === true) {
        router.push("/admin/products?deleted=1");
        return;
      }
      setError(
        res.status === 409
          ? (body?.error?.message ?? BLOCKED_MESSAGE)
          : (body?.error?.message ?? "Gagal menghapus produk."),
      );
    } catch {
      setError("Gagal menghapus produk. Periksa koneksi lalu coba lagi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-6 border-t border-dotted border-slate-300 pt-4">
      {error && (
        <p role="alert" className="alert-error mb-3">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn-danger"
        onClick={onDelete}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? "Menghapus…" : "Hapus Produk"}
      </button>
      <p className="hint">Tidak bisa dihapus selama masih ada pesanan aktif.</p>
    </div>
  );
}
