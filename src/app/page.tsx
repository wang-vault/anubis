import Link from "next/link";
import { listActiveProducts } from "@/lib/products";
import { getAuthContext } from "@/lib/authz";
import { ProductCard } from "@/components/ProductCard";

const HOW_IT_WORKS = [
  { n: "01", t: "Pilih berita utama", d: "Buka katalog, baca detailnya, lalu pilih produk yang paling cocok." },
  { n: "02", t: "Bayar lewat WhatsApp", d: "Chat penjual dengan tombol sekali klik (kode order & nominal sudah terisi), transfer sesuai petunjuk, lalu konfirmasi di website." },
  { n: "03", t: "Pesanan diberitakan", d: "Penjual memproses pesanan dan mengabarkan kabar baik lewat WhatsApp." },
] as const;

export default async function HomePage() {
  const products = (await listActiveProducts()).slice(0, 8);
  // User yang sudah login tidak lagi disuguhi CTA "daftar/masuk" (dead link).
  // getAuthContext() di-cache per-request — Header sudah memanggilnya.
  const ctx = await getAuthContext();

  return (
    <div className="container-x space-y-10">
      <section className="front-page-hero" aria-labelledby="front-page-title">
        <div className="front-page-copy">
          <p className="eyebrow">Berita utama · Edisi hari ini</p>
          <h1 id="front-page-title" className="front-page-title">
            Belanja gampang, <em>kabar</em> pembayaran datang cepat.
          </h1>
          <p className="front-page-deck">
            Pilih barang favoritmu, selesaikan pembayaran bersama penjual lewat WhatsApp, dan biarkan kami mengurus kabar berikutnya. Semua proses
            dibuat singkat, jelas, dan terasa seperti halaman depan yang menyenangkan.
          </p>
          <div className="hero-actions">
            <Link href="/products" className="btn-primary">
              Baca Katalog →
            </Link>
            {/* CTA sekunder mengikuti status login — user yang sudah masuk tidak
                disuguhi tautan daftar lagi (middleware menjadikannya dead link). */}
            {ctx ? (
              <Link href="/orders" className="btn-secondary">
                Lihat Pesanan Saya →
              </Link>
            ) : (
              <Link href="/auth/register" className="btn-secondary">
                Buka Akun Gratis
              </Link>
            )}
          </div>
          <div className="hero-facts" aria-label="Keunggulan toko">
            <div className="hero-fact">
              <strong>Manual</strong>
              <span>Cara bayar tunggal</span>
            </div>
            <div className="hero-fact">
              <strong>WhatsApp</strong>
              <span>Detail pembayaran</span>
            </div>
            <div className="hero-fact">
              <strong>WhatsApp</strong>
              <span>Kabar pesanan</span>
            </div>
          </div>
        </div>
        <aside className="hero-brief" aria-label="Ringkasan layanan">
          <p className="hero-brief-label">Headline layanan</p>
          <div>
            <p className="hero-brief-title">Pesan.<br />Transfer.<br />Selesai.</p>
            <p className="hero-brief-copy">
              Satu metode bayar, tanpa bingung memilih: buat pesanan, chat penjual lewat WhatsApp
              (pesan sudah berisi kode order & nominal), bayar, lalu penjual memverifikasi mutasinya.
            </p>
          </div>
        </aside>
      </section>

      <section aria-labelledby="how-it-works-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Cara kerja</p>
            <h2 id="how-it-works-title" className="section-title">
              Tiga langkah, satu pengalaman ringan.
            </h2>
          </div>
          <span className="hidden text-xs font-bold uppercase tracking-widest text-slate-400 sm:inline">
            Panduan pembaca
          </span>
        </div>
        <div className="steps-grid mt-4">
          {HOW_IT_WORKS.map((s) => (
            <article key={s.n} className="step-card">
              <span className="step-number" aria-hidden>
                {s.n}
              </span>
              <div>
                <h3 className="step-title">{s.t}</h3>
                <p className="step-copy">{s.d}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="latest-products-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Katalog pilihan</p>
            <h2 id="latest-products-title" className="section-title">
              Produk terbaru
            </h2>
          </div>
          <Link href="/products" className="section-link">
            Semua produk →
          </Link>
        </div>
        <div className="mt-4">
          {products.length === 0 ? (
            <div className="paper-empty p-10 text-center text-sm text-slate-500">
              Belum ada produk. Pemilik toko dapat menambahkannya lewat dashboard penjual.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="paper-inset grid gap-3 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-5">
        <span className="grid size-11 place-items-center border border-slate-900 bg-[#d3942b] font-serif text-xl font-black text-slate-900">
          !
        </span>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-brand-700">Catatan redaksi</p>
          <p className="mt-1 font-serif text-sm leading-6 text-slate-700">
            Email perlu diverifikasi sebelum belanja agar setiap kabar pesanan sampai ke orang yang
            tepat.
          </p>
        </div>
        {ctx ? (
          <Link href="/orders" className="btn-secondary btn-sm justify-self-start sm:justify-self-end">
            Lihat Pesanan Saya →
          </Link>
        ) : (
          <Link href="/auth/register" className="btn-secondary btn-sm justify-self-start sm:justify-self-end">
            Daftar sekarang
          </Link>
        )}
      </section>
    </div>
  );
}
