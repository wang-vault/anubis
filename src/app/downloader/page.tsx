import type { Metadata } from "next";
import Link from "next/link";
import { DOWNLOADERS } from "@/lib/downloaders";

export const metadata: Metadata = {
  title: "Downloader",
  description:
    "Pilih downloader gratis tanpa login: TikTok (tanpa watermark / audio), YouTube (video & Shorts), atau Instagram (reel & post).",
};

/**
 * Halaman PEMILIH DOWNLOADER — PUBLIK (tanpa login, tidak di-gate middleware,
 * tanpa database, tanpa JS klien).
 *
 * Satu-satunya tujuan tombol "Downloader" di header, footer, dan beranda.
 * Di sini pengunjung baru memilih platformnya; setiap downloader punya kartu
 * dan tombolnya sendiri. Daftarnya dibaca dari src/lib/downloaders.ts.
 */
export default function DownloaderHubPage() {
  return (
    <div className="container-x max-w-5xl">
      <div className="paper-heading">
        <p className="section-kicker">Alat gratis · Tanpa login</p>
        <h1 className="paper-heading-title">Pilih downloader</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          Semua downloader ada di satu halaman ini. Pilih platform asal videonya, lalu tempel tautannya di
          halaman berikutnya — gratis dan tidak perlu akun.
        </p>
      </div>

      <ul className="downloader-grid mt-6" aria-label="Daftar downloader">
        {DOWNLOADERS.map((tool) => {
          const titleId = `downloader-${tool.slug}-title`;
          return (
            <li key={tool.slug} className="flex">
              <article className={`downloader-card downloader-card--${tool.tone}`} aria-labelledby={titleId}>
                <div className="downloader-card-head">
                  <span className="downloader-mark" aria-hidden>
                    {tool.mark}
                  </span>
                  <div className="min-w-0">
                    <p className="downloader-card-kicker">{tool.platform}</p>
                    <h2 id={titleId} className="downloader-card-title">
                      {tool.name}
                    </h2>
                  </div>
                </div>

                <p className="downloader-card-text">{tool.description}</p>

                <ul className="tool-teaser-list" aria-label={`Fitur ${tool.name}`}>
                  {tool.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>

                <p className="downloader-card-accepts">
                  <span className="downloader-card-accepts-label">Tautan:</span> {tool.accepts.join(" · ")}
                </p>

                <Link href={tool.href} className="btn-primary downloader-card-action">
                  Buka {tool.name} →
                </Link>
              </article>
            </li>
          );
        })}
      </ul>

      <section className="paper-inset mt-8 flex items-start gap-3 p-4 sm:p-5">
        <span
          className="grid size-9 flex-none place-items-center border border-slate-900 bg-slate-900 font-serif text-sm font-black text-white"
          aria-hidden
        >
          !
        </span>
        <p className="text-sm leading-6 text-slate-600">
          <strong className="text-slate-900">Gunakan dengan bijak.</strong> Unduh hanya konten milikmu sendiri
          atau yang kamu punya izinnya. Setiap downloader dibatasi 10 tautan per menit, tidak butuh akun, dan
          tidak menyentuh data pesananmu.
        </p>
      </section>
    </div>
  );
}
