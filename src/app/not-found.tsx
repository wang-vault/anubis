import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-x mx-auto max-w-md py-16 text-center">
      <p className="text-5xl" aria-hidden>🧐</p>
      <h1 className="mt-3 text-xl font-bold">Halaman tidak ditemukan</h1>
      <p className="mt-2 text-sm text-slate-500">
        Tautan mungkin salah, atau konten (produk/order) sudah tidak tersedia.
      </p>
      <Link href="/" className="btn-primary mt-6">
        Kembali ke Beranda
      </Link>
    </div>
  );
}
