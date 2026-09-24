"use client";

import { useState, type FormEvent } from "react";
import { DownloaderBackLink } from "@/components/DownloaderBackLink";

/**
 * Halaman Instagram Downloader — fitur PUBLIK terpisah dari toko (tanpa
 * login, tanpa menyentuh database). Semua pengambilan data lewat
 * /api/instagram yang sudah dibatasi rate limit per IP.
 *
 * Alur: user menempel link reel/post Instagram → GET /api/instagram?url=… →
 * tampilkan tombol unduh video.
 */

interface InstagramMedia {
  url: string;
}

type ApiResponse =
  | ({ ok: true } & InstagramMedia)
  | { ok: false; error: { code: string; message: string } };

export default function InstagramDownloaderPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InstagramMedia | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/instagram?url=${encodeURIComponent(trimmed)}`);

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

      setResult({ url: body.url });
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
      <DownloaderBackLink />
      <div className="paper-heading">
        <p className="section-kicker">Alat gratis · Tanpa login</p>
        <h1 className="paper-heading-title">Instagram Downloader</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Tempel tautan reel atau post Instagram untuk mengunduh videonya. Gratis dan tidak perlu akun.
        </p>
      </div>

      {/* ---- Form ---- */}
      <form onSubmit={handleSubmit} className="card mt-6 p-5" noValidate>
        <label htmlFor="instagram-url" className="label">
          Link video Instagram
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="instagram-url"
            className="input"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.instagram.com/reel/… atau https://www.instagram.com/p/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            aria-describedby="instagram-url-hint"
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
        <p id="instagram-url-hint" className="hint">
          Mendukung tautan <strong>instagram.com/reel/</strong> dan <strong>instagram.com/p/</strong> ·
          batas 10 permintaan per menit per IP.
        </p>
      </form>

      {/* ---- Loading ---- */}
      {loading && (
        <div className="card mt-6 p-5" aria-busy="true" aria-live="polite">
          <p className="text-sm font-bold">Mengambil tautan video dari Instagram…</p>
          <div className="mt-4 animate-pulse space-y-2.5">
            <div className="h-4 w-11/12 bg-slate-100" />
            <div className="h-4 w-3/4 bg-slate-100" />
            <div className="h-9 w-1/2 bg-slate-100" />
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
          <p className="section-kicker">Selesai</p>
          <h2 className="mt-1 font-serif text-lg font-black leading-snug">Video siap diunduh</h2>
          <p className="mt-1.5 text-sm leading-6 text-slate-600">
            Tekan tombol di bawah untuk mengunduh videonya.
          </p>
          <div className="mt-4">
            <a
              href={result.url}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
              title="Unduh video Instagram"
            >
              ↓ Download Video
            </a>
          </div>
          <p className="hint mt-3">
            Tautan terbuka di tab baru. Bila unduhan tidak mulai otomatis: tekan lama (HP) atau klik kanan
            (komputer) lalu pilih <em>“Simpan tautan/medianya”</em>.
          </p>
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
