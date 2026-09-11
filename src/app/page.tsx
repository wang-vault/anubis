import Link from "next/link";
import { listActiveProducts } from "@/lib/products";
import { ProductCard } from "@/components/ProductCard";

const HOW_IT_WORKS = [
  { n: "1", t: "Pilih produk", d: "Buka katalog dan klik Beli Sekarang." },
  { n: "2", t: "Bayar QRIS", d: "Scan QR — pembayaran terverifikasi otomatis, tanpa perlu kirim bukti transfer." },
  { n: "3", t: "Pesanan dikirim", d: "Penjual memproses pesanan dan menghubungimu lewat WhatsApp." },
] as const;

export default async function HomePage() {
  const products = (await listActiveProducts()).slice(0, 8);

  return (
    <div className="container-x space-y-10">
      {/* Hero */}
      <section className="card overflow-hidden bg-gradient-to-br from-brand-600 to-emerald-700 p-8 text-white sm:p-12">
        <h1 className="max-w-xl text-2xl font-extrabold leading-tight sm:text-4xl">
          Belanja gampang: bayar QRIS, pesanan diantar lewat WhatsApp.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-emerald-50 sm:text-base">
          Pembayaran terverifikasi otomatis dalam hitungan detik. Kamu cukup scan QR — sisanya
          biar penjual yang urus.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/products" className="btn bg-white text-brand-700 hover:bg-emerald-50">
            Lihat Produk →
          </Link>
          <Link href="/auth/register" className="btn border border-white/40 text-white hover:bg-white/10">
            Daftar Akun
          </Link>
        </div>
      </section>

      {/* Cara kerja */}
      <section aria-label="Cara bekerja toko">
        <div className="grid gap-3 sm:grid-cols-3">
          {HOW_IT_WORKS.map((s) => (
            <div key={s.n} className="card flex gap-3 p-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                {s.n}
              </span>
              <div>
                <h2 className="text-sm font-semibold">{s.t}</h2>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Produk terbaru */}
      <section aria-label="Produk terbaru">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-lg font-bold">Produk Terbaru</h2>
          <Link href="/products" className="text-sm font-medium text-brand-700 hover:underline">
            Semua produk →
          </Link>
        </div>
        {products.length === 0 ? (
          <div className="card p-10 text-center text-sm text-slate-500">
            Belum ada produk. Pemilik toko dapat menambahkannya lewat dashboard admin.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
