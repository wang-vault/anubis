"use client";

import { useState, type FormEvent } from "react";

/**
 * Halaman TikTok Downloader — fitur PUBLIK terpisah dari toko (tanpa login,
 * tanpa menyentuh database). Semua pengambilan data lewat /api/tiktok yang
 * sudah dibatasi rate limit per IP.
 *
 * Alur: user menempel link TikTok → GET /api/tiktok?url=… → tampilkan sampul,
 * judul, author, dan tiga tombol unduh (tanpa watermark / dengan watermark /
 * audio saja).
 */

interface TikTokMedia {
  title: string;
  cover: string;
  play: string;
  wmplay: string;
  music: string;
  duration: number;
  author: { nickname: string; avatar: string };
}

type ApiResponse = ({ ok: true } & TikTokMedia) | { ok: false; error: { code: string; message: string } };

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Tombol unduh; turun jadi placeholder non-aktif bila tautan tidak tersedia. */
function DownloadButton({
  href,
  label,
  variant,
}: {
  href: string;
  label: string;
  variant: "primary" | "secondary";
}) {
  const cls = variant === "primary" ? "btn-primary" : "btn-secondary";
  if (!href) {
    return (
      <span className={`${cls} cursor-not-allowed opacity-50`} aria-disabled="true" title="Tidak tersedia untuk video ini">
        {label}
      </span>
    );
  }
  return (
    <a
      href={href}
      download
      target="_blank"
      rel="noopener noreferrer"
      className={cls}
      title={`Unduh: ${label}`}
    >
      {label}
    </a>
  );
}

export default function TikTokDownloaderPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TikTokMedia | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/tiktok?url=${encodeURIComponent(trimmed)}`);

      // Respons bisa jadi bukan JSON (mis. halaman error infrastruktur) —
      // jangan biarkan res.json() melempar pesan teknis mentah ke user.
      let body: ApiResponse | null = null;
      try {
        body = (await res.json()) as ApiResponse;
      } catch {
        // dibiarkan null; ditangani sebagai kegagalan umum di bawah.
      }

      if (!res.ok || !body || body.ok === false) {
        const message =
          body && body.ok === false ? body.error.message : `Gagal memproses permintaan (HTTP ${res.status}).`;
        throw new Error(message);
      }

      setResult({
        title: body.title,
        cover: body.cover,
        play: body.play,
        wmplay: body.wmplay,
        music: body.music,
        duration: body.duration,
        author: body.author,
      });
    } catch (err) {
      if (err instanceof TypeError) {
        // fetch() melempar TypeError saat jaringan gagal (offline, DNS, dsb.).
        setError("Tidak dapat terhubung ke server. Periksa koneksi internetmu lalu coba lagi.");
      } else {
        setError(err instanceof Error && err.message ? err.message : "Terjadi kesalahan tak terduga. Coba lagi.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-x max-w-3xl">
      <div className="paper-heading">
        <p className="section-kicker">Alat gratis · Tanpa login</p>
        <h1 className="paper-heading-title">TikTok Downloader</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Tempel tautan video TikTok untuk mengunduh video <strong>tanpa watermark</strong>, video dengan
          watermark, atau audionya saja. Gratis dan tidak perlu akun.
        </p>
      </div>

      {/* ---- Form ---- */}
      <form onSubmit={handleSubmit} className="card mt-6 p-5" noValidate>
        <label htmlFor="tiktok-url" className="label">
          Link video TikTok
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="tiktok-url"
            className="input"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.tiktok.com/@user/video/… atau https://vm.tiktok.com/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            aria-describedby="tiktok-url-hint"
          />
          <button type="submit" className="btn-primary sm:flex-none" disabled={loading || !url.trim()}>
            {loading ? (
              <>
                <span className="inline-block size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
                Memproses…
              </>
            ) : (
              "Proses →"
            )}
          </button>
        </div>
        <p id="tiktok-url-hint" className="hint">
          Mendukung tautan <strong>tiktok.com</strong>, <strong>vm.tiktok.com</strong>, dan{" "}
          <strong>vt.tiktok.com</strong> · batas 10 permintaan per menit per IP.
        </p>
      </form>

      {/* ---- Loading ---- */}
      {loading && (
        <div className="card mt-6 p-5" aria-busy="true" aria-live="polite">
          <p className="text-sm font-bold">Mengambil info video dari TikTok…</p>
          <div className="mt-4 flex animate-pulse gap-4">
            <div className="h-48 w-36 flex-none border border-slate-200 bg-slate-100" />
            <div className="flex-1 space-y-2.5 self-center">
              <div className="h-4 w-11/12 bg-slate-100" />
              <div className="h-4 w-3/4 bg-slate-100" />
              <div className="h-8 w-1/2 bg-slate-100" />
              <div className="h-8 w-1/3 bg-slate-100" />
            </div>
          </div>
        </div>
      )}

      {/* ---- Error ---- */}
      {error && (
        <div className="alert-error mt-4" role="alert">
          {error}
        </div>
      )}

      {/* ---- Hasil ---- */}
      {result && (
        <article className="card mt-6 p-5" aria-live="polite">
          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="relative w-full flex-none self-start border border-slate-900 bg-slate-100 sm:w-52">
              {result.cover ? (
                // <img> biasa (bukan next/image) agar tak perlu mendaftarkan
                // domain CDN eksternal di next.config — file yang tidak boleh diubah.
                <img
                  src={result.cover}
                  alt={result.title ? `Sampul video: ${result.title}` : "Sampul video TikTok"}
                  className="aspect-[19/25] w-full object-cover"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
              ) : (
                <div className="grid aspect-[19/25] w-full place-items-center text-xs font-bold text-slate-400">
                  Tanpa sampul
                </div>
              )}
              <span className="badge absolute bottom-2 right-2 border-slate-900 bg-slate-900 text-white">
                {formatDuration(result.duration)}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="font-serif text-lg font-black leading-snug">
                {result.title || "Video TikTok"}
              </h2>
              <div className="mt-2.5 flex items-center gap-2.5">
                {result.author.avatar ? (
                  <img
                    src={result.author.avatar}
                    alt=""
                    className="size-8 flex-none rounded-full border border-slate-900 object-cover"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                ) : (
                  <span
                    className="grid size-8 flex-none place-items-center rounded-full border border-slate-900 bg-slate-100 text-xs font-black text-slate-500"
                    aria-hidden
                  >
                    {result.author.nickname ? result.author.nickname.charAt(0).toUpperCase() : "?"}
                  </span>
                )}
                <span className="truncate text-sm font-bold text-slate-700">
                  {result.author.nickname || "Tanpa nama"}
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <DownloadButton href={result.play} label="↓ Video Tanpa Watermark" variant="primary" />
                <DownloadButton href={result.wmplay} label="↓ Video + Watermark" variant="secondary" />
                <DownloadButton href={result.music} label="♪ Audio Saja" variant="secondary" />
              </div>

              <p className="hint">
                Tautan terbuka di tab baru. Bila unduhan tidak mulai otomatis: tekan lama (HP) atau klik kanan
                (komputer) lalu pilih <em>“Simpan tautan/medianya”</em>.
              </p>
            </div>
          </div>
        </article>
      )}

      {/* ---- Catatan ---- */}
      <section className="paper-inset mt-8 flex items-start gap-3 p-4 sm:p-5">
        <span
          className="grid size-9 flex-none place-items-center border border-slate-900 bg-slate-900 font-serif text-sm font-black text-white"
          aria-hidden
        >
          !
        </span>
        <p className="text-sm leading-6 text-slate-600">
          <strong className="text-slate-900">Gunakan dengan bijak.</strong> Unduh hanya konten milikmu sendiri
          atau yang kamu punya izinnya. Hak cipta tetap milik pembuatnya — ini bukan alat untuk mendistribusikan
          ulang karya orang lain.
        </p>
      </section>
    </div>
  );
}
