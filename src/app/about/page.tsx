import type { Metadata } from "next";
import Link from "next/link";
import { getAuthContext } from "@/lib/authz";
import { getManualPaymentView } from "@/lib/payment-config";
import { DOWNLOADER_HUB_PATH, DOWNLOADERS } from "@/lib/downloaders";
import { waMeUrl } from "@/lib/phone";

export const metadata: Metadata = {
  title: "Tentang Kami",
  description:
    "Profil toko: dikelola satu penjual, satu metode bayar (transfer manual via WhatsApp), setiap pembayaran diverifikasi manusia, plus alat downloader gratis tanpa login.",
};

/**
 * Halaman TENTANG KAMI — PUBLIK (bisa dibuka tanpa akun, tidak di-gate
 * middleware, tanpa JS klien).
 *
 * Isinya menjelaskan apa toko ini, bagaimana satu-satunya metode bayar
 * bekerja, prinsip yang ditegakkan kode (harga server-side, klaim ≠ lunas,
 * kode unik nominal), FAQ, dan cara menghubungi penjual.
 *
 * Bagian yang HIDUP mengikuti konfigurasi penjual (tanpa deploy ulang):
 *  - nomor WhatsApp penjual + masa berlaku pesanan → getManualPaymentView()
 *    (kolom `manual_payment_settings`, diisi lewat /admin/settings);
 *  - jumlah alat gratis → src/lib/downloaders.ts;
 *  - CTA menyesuaikan status login, sama seperti beranda & /testimoni.
 *
 * Nomor WhatsApp penjual memang informasi publik (buyer harus bisa chat),
 * tetapi tidak ada data pembeli mana pun yang tampil di halaman ini.
 */

/** Alur belanja dari sudut pandang pembeli — sama dengan yang ditegakkan kode. */
const STEPS = [
  {
    n: "01",
    t: "Buat akun & verifikasi email",
    d: "Sekali saja. Email yang terverifikasi memastikan kabar pesanan sampai ke orang yang tepat.",
  },
  {
    n: "02",
    t: "Pilih produk lalu checkout",
    d: "Harga dan ketersediaan dibaca ulang di server saat pesanan dibuat — bukan dari browser — jadi nominalnya selalu sah.",
  },
  {
    n: "03",
    t: "Chat penjual di WhatsApp",
    d: "Satu tombol membuka chat berisi kode pesanan, produk, dan nominal. Penjual membalas dengan detail transfer terbaru (QRIS, rekening, atau e-wallet).",
  },
  {
    n: "04",
    t: "Transfer, klaim, selesai",
    d: "Transfer sesuai nominal, tekan “Saya sudah transfer”, penjual mencocokkan mutasi lalu menandai pesanan lunas dan memprosesnya.",
  },
] as const;

/** Janji yang bukan sekadar slogan — masing-masing punya mekanismenya di kode. */
const PRINCIPLES = [
  {
    mark: "Rp",
    t: "Harga ditentukan server",
    d: "Total pesanan dihitung ulang dari database toko. Apa pun yang dikirim browser diabaikan, sehingga harga tidak bisa diutak-atik dari sisi pembeli.",
  },
  {
    mark: "✓",
    t: "Klaim bukan berarti lunas",
    d: "Menekan “Saya sudah transfer” hanya memasukkan pesanan ke antrian pemeriksaan. Status LUNAS diberikan penjual setelah dananya terlihat di mutasi.",
  },
  {
    mark: "#",
    t: "Kode unik di setiap nominal",
    d: "Tagihan ditambah angka unik 1–999 rupiah per pesanan supaya transfermu gampang dikenali di mutasi dan konfirmasi jadi lebih cepat.",
  },
  {
    mark: "WA",
    t: "Detail bayar dikirim di chat",
    d: "QRIS, nomor rekening, atau e-wallet tidak disimpan di halaman mana pun. Penjual mengirimkannya langsung di WhatsApp, jadi tidak pernah basi.",
  },
  {
    mark: "ID",
    t: "Data pribadi seperlunya",
    d: "Tidak ada PIN, OTP, atau data kartu yang kami minta. Di halaman testimoni pun nama pembeli dipendekkan, tanpa nomor, email, atau nominal.",
  },
  {
    mark: "↓",
    t: "Alat gratis untuk siapa saja",
    d: `${DOWNLOADERS.length} downloader bisa dipakai tanpa akun, tanpa biaya, dan sama sekali tidak menyentuh data pesanan.`,
  },
] as const;

export default async function AboutPage() {
  const siteName = process.env.NEXT_PUBLIC_SITE_NAME ?? "Toko Saya";
  // getAuthContext() di-cache per-request (Header sudah memanggilnya).
  const [ctx, manual] = await Promise.all([getAuthContext(), getManualPaymentView()]);
  const platforms = [...new Set(DOWNLOADERS.map((tool) => tool.platform))];

  // Nomor WA penjual memang publik: tombol ini pintu tanya-jawab sebelum belanja.
  const waHref = manual.whatsappNumber
    ? waMeUrl(
        manual.whatsappNumber,
        `Halo ${siteName}, saya mau bertanya soal produk di toko sebelum memesan.`,
      )
    : null;

  const faq = [
    {
      q: "Harus punya akun untuk belanja?",
      a: "Ya, dan emailnya perlu diverifikasi satu kali. Akun dipakai untuk menyimpan riwayat pesanan serta memastikan kabar pembayaran sampai ke orang yang tepat. Halaman testimoni dan semua downloader tetap bisa dibuka tanpa akun.",
    },
    {
      q: "Metode pembayaran apa saja yang tersedia?",
      a: "Hanya satu: transfer manual yang dikoordinasikan lewat WhatsApp. Tidak ada payment gateway, tidak ada tagihan otomatis. Tujuan transfer (QRIS, rekening bank, atau e-wallet) dikirim penjual di chat supaya selalu yang terbaru.",
    },
    {
      q: "Kenapa nominal transfernya ada angka unik?",
      a: "Setiap pesanan mendapat tambahan 1–999 rupiah yang khas. Angka kecil itu membuat transfermu mudah dibedakan di mutasi, jadi penjual bisa memastikan pembayaran lebih cepat. Transfer persis sebesar nominal yang tertera di halaman pembayaran.",
    },
    {
      q: "Berapa lama waktu untuk membayar?",
      a: `Pesanan yang belum diklaim kadaluarsa otomatis setelah ${manual.expiryMinutes} menit, supaya stok tidak terkunci terlalu lama. Begitu kamu menekan “Saya sudah transfer”, pesanan tidak akan kadaluarsa dan menunggu diperiksa penjual.`,
    },
    {
      q: "Sudah transfer, tapi status belum lunas?",
      a: "Status berubah setelah penjual melihat dananya di mutasi — biasanya cepat, tetapi mutasi bank kadang tertunda. Kirim bukti transfer di chat WhatsApp yang sama agar pengecekan lebih mudah; pesanan tetap aman di antrian pemeriksaan.",
    },
    {
      q: "Bagaimana kalau ada masalah dengan pesanan?",
      a: "Balas saja chat WhatsApp yang sudah ada — semua koordinasi pesanan terjadi di sana, jadi penjual bisa langsung melihat kode pesanan dan riwayat percakapannya.",
    },
  ] as const;

  return (
    <div className="container-x space-y-10">
      <section className="front-page-hero" aria-labelledby="about-title">
        <div className="front-page-copy">
          <p className="eyebrow">Tentang kami · Profil toko</p>
          <h1 id="about-title" className="front-page-title">
            Tentang <em>{siteName}</em>
          </h1>
          <p className="front-page-deck">
            Toko online yang dikelola satu penjual: kamu memilih produk, berbicara langsung dengan
            penjualnya di WhatsApp, transfer, lalu pesanan diproses setelah pembayarannya
            benar-benar dicek. Tidak ada payment gateway, tidak ada robot yang memutuskan nasib
            pesananmu.
          </p>
          <div className="hero-actions">
            <Link href="/products" className="btn-primary">
              Lihat Katalog →
            </Link>
            <Link href="/testimoni" className="btn-secondary">
              Baca Testimoni
            </Link>
          </div>
          <div className="hero-facts" aria-label="Ringkasan toko">
            <div className="hero-fact">
              <strong>1 metode</strong>
              <span>Transfer manual</span>
            </div>
            <div className="hero-fact">
              <strong>{manual.expiryMinutes} menit</strong>
              <span>Masa bayar pesanan</span>
            </div>
            <div className="hero-fact">
              <strong>{DOWNLOADERS.length} alat</strong>
              <span>Gratis tanpa login</span>
            </div>
          </div>
        </div>
        <aside className="hero-brief" aria-label="Kartu nama toko">
          <p className="hero-brief-label">Kartu nama</p>
          <div>
            <p className="hero-brief-title">
              Dikelola
              <br />
              manusia,
              <br />
              bukan bot.
            </p>
            <p className="hero-brief-copy">
              Setiap pembayaran dibaca, dicocokkan dengan mutasi, lalu dikabarkan penjual lewat
              WhatsApp. Kalau ada yang terasa janggal, kamu bisa bertanya ke orangnya — bukan ke
              formulir tiket.
            </p>
          </div>
        </aside>
      </section>

      <section aria-labelledby="about-story-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Kisah singkat</p>
            <h2 id="about-story-title" className="section-title">
              Berjualan tanpa perantara, belanja tanpa tebak-tebakan.
            </h2>
          </div>
          <span className="hidden text-xs font-bold uppercase tracking-widest text-slate-400 sm:inline">
            Ruang redaksi
          </span>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <div className="space-y-3 font-serif text-[0.95rem] leading-7 text-slate-700">
            <p>
              <strong className="text-slate-900">{siteName}</strong> dibuat untuk penjual tunggal
              yang ingin berjualan online tanpa ribet: tanpa marketplace, tanpa biaya langganan
              payment gateway, dan tanpa server yang harus dijaga semalaman. Katalog, pesanan, dan
              pencatatan pembayaran dikerjakan di satu tempat; sisanya diselesaikan lewat
              percakapan, persis seperti belanja di toko sebelah.
            </p>
            <p>
              Konsekuensinya sengaja kami pilih: pembayaran diverifikasi manusia. Penjual
              mencocokkan nominal transfermu dengan mutasi, menandai pesanan lunas, lalu mengabari
              saat barang diproses. Sedikit lebih manual, tetapi tidak ada pesanan yang
              menggantung “karena sistem” dan tidak ada data pembayaran sensitif yang menumpuk di
              aplikasi.
            </p>
          </div>
          <aside className="card p-5" aria-labelledby="about-nots-title">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-brand-700">
              Yang tidak kami lakukan
            </p>
            <h3 id="about-nots-title" className="mt-1 font-serif text-lg font-black">
              Sengaja dikosongkan
            </h3>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
              <li className="flex gap-2">
                <span aria-hidden className="font-black text-brand-700">
                  ×
                </span>
                Meminta PIN, OTP, atau data kartu — kapan pun, lewat kanal apa pun.
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="font-black text-brand-700">
                  ×
                </span>
                Menyimpan QRIS atau nomor rekening di halaman yang bisa basi.
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="font-black text-brand-700">
                  ×
                </span>
                Menampilkan nomor, email, atau nominal pembeli di halaman publik.
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="font-black text-brand-700">
                  ×
                </span>
                Menagih biaya langganan; kamu hanya membayar pesananmu.
              </li>
            </ul>
          </aside>
        </div>
      </section>

      <section aria-labelledby="about-how-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Cara kerja</p>
            <h2 id="about-how-title" className="section-title">
              Empat langkah, dari keranjang sampai kabar baik.
            </h2>
          </div>
          <Link href="/products" className="section-link">
            Mulai belanja →
          </Link>
        </div>
        <div className="about-steps mt-4">
          {STEPS.map((s) => (
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

      <section aria-labelledby="about-principles-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Prinsip redaksi</p>
            <h2 id="about-principles-title" className="section-title">
              Janji yang ada mekanismenya.
            </h2>
          </div>
          <span className="hidden text-xs font-bold uppercase tracking-widest text-slate-400 sm:inline">
            Bukan sekadar slogan
          </span>
        </div>
        <div className="about-values mt-4">
          {PRINCIPLES.map((p) => (
            <article key={p.t} className="card flex gap-3 p-5">
              <span className="about-value-mark" aria-hidden>
                {p.mark}
              </span>
              <div className="min-w-0">
                <h3 className="font-serif text-base font-black leading-snug">{p.t}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{p.d}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Alat gratis: SATU tautan ke halaman pemilih (aturan satu pintu masuk —
          halaman lain tidak menautkan tiap downloader satu per satu). */}
      <section className="tool-teaser" aria-labelledby="about-tools-title">
        <div>
          <p className="section-kicker">Alat gratis · Tanpa login</p>
          <h2 id="about-tools-title" className="tool-teaser-title">
            Bonus untuk pengunjung
          </h2>
          <p className="tool-teaser-text">
            Selain berjualan, kami menyediakan downloader video yang bisa dipakai siapa saja —
            gratis, tanpa akun, dan terpisah dari data toko.
          </p>
          <ul className="tool-teaser-list" aria-label="Platform yang didukung">
            {/* Satu chip per platform: beberapa alat bisa berbagi platform yang sama. */}
            {platforms.map((platform) => (
              <li key={platform}>{platform}</li>
            ))}
          </ul>
        </div>
        <div className="tool-teaser-action">
          <Link href={DOWNLOADER_HUB_PATH} className="btn-primary">
            Buka Downloader →
          </Link>
          <span className="tool-teaser-note">
            {DOWNLOADERS.length} alat · pilih di halaman berikutnya
          </span>
        </div>
      </section>

      <section aria-labelledby="about-faq-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Surat pembaca</p>
            <h2 id="about-faq-title" className="section-title">
              Pertanyaan yang sering masuk
            </h2>
          </div>
          <span className="hidden text-xs font-bold uppercase tracking-widest text-slate-400 sm:inline">
            Klik untuk membuka
          </span>
        </div>
        <div className="about-faq mt-4">
          {faq.map((item) => (
            <details key={item.q} className="about-faq-item">
              <summary>{item.q}</summary>
              <p className="about-faq-answer">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="about-contact" aria-labelledby="about-contact-title">
        <div>
          <p className="section-kicker">Hubungi kami</p>
          <h2 id="about-contact-title" className="mt-2 font-serif text-2xl font-black">
            Ada yang ingin ditanyakan dulu?
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            {/* Nama penjual disisipkan di dalam string agar tidak ada spasi
                menggantung sebelum titik ketika namanya belum diisi. */}
            {`Tanya stok, varian, atau estimasi pengiriman sebelum memesan — chat langsung ke penjual${
              manual.sellerName ? ` (${manual.sellerName})` : ""
            }.`}{" "}
            Untuk pesanan yang sudah dibuat, gunakan tombol WhatsApp di halaman pembayaran agar
            kode pesanannya ikut terkirim.
          </p>
          {manual.whatsappDisplay && (
            <p className="mt-3 text-sm font-bold text-slate-900">
              WhatsApp penjual:{" "}
              <span className="font-serif text-base">{manual.whatsappDisplay}</span>
            </p>
          )}
        </div>
        <div className="grid gap-2 md:justify-items-end">
          {waHref ? (
            <>
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary w-full md:w-auto"
              >
                Chat Penjual di WhatsApp →
              </a>
              <span className="text-xs text-slate-500">
                Jam balas mengikuti jam kerja penjual.
              </span>
            </>
          ) : (
            <div className="alert-warn w-full">
              Nomor WhatsApp penjual belum ditampilkan. Silakan cek kembali sebentar lagi, atau
              buat pesanan lebih dulu — tombol chat akan muncul di halaman pembayaran.
            </div>
          )}
          <Link href="/products" className="btn-secondary w-full md:w-auto">
            Lihat Katalog
          </Link>
        </div>
      </section>

      <section className="paper-inset grid gap-3 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-5">
        <span
          className="grid size-11 place-items-center border border-slate-900 bg-[#d3942b] font-serif text-xl font-black text-slate-900"
          aria-hidden
        >
          !
        </span>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-brand-700">
            Catatan redaksi
          </p>
          <p className="mt-1 font-serif text-sm leading-6 text-slate-700">
            {ctx
              ? "Akunmu sudah siap — pesanan berikutnya tinggal beberapa klik saja."
              : "Email diverifikasi sekali saat mendaftar, supaya setiap kabar pesanan sampai ke orang yang tepat."}
          </p>
        </div>
        {ctx ? (
          <Link href="/orders" className="btn-secondary btn-sm justify-self-start sm:justify-self-end">
            Lihat Pesanan Saya →
          </Link>
        ) : (
          <Link
            href="/auth/register"
            className="btn-secondary btn-sm justify-self-start sm:justify-self-end"
          >
            Buat Akun Gratis
          </Link>
        )}
      </section>
    </div>
  );
}
