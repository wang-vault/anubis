import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-x mx-auto max-w-md py-16 text-center">
      <div className="mx-auto grid size-16 place-items-center border border-slate-900 bg-[#d3942b] font-serif text-2xl font-black">404</div>
      <p className="section-kicker mt-5 justify-center">Edisi tidak ditemukan</p>
      <h1 className="mt-2 text-2xl font-black">Halaman tidak ditemukan</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Tautan mungkin salah, atau konten (produk/order) sudah tidak tersedia.
      </p>
      <Link href="/" className="btn-primary mt-6">
        Kembali ke Beranda →
      </Link>
    </div>
  );
}
