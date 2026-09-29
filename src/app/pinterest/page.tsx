"use client";

import { useState, type FormEvent } from "react";
import { DownloaderBackLink } from "@/components/DownloaderBackLink";

/**
 * Halaman Pinterest Downloader — fitur PUBLIK terpisah dari toko (tanpa login,
 * tanpa menyentuh database). Semua pengambilan data lewat /api/pinterest yang
 * sudah dibatasi rate limit per IP.
 *
 * Alur: user menempel tautan pin → GET /api/pinterest?url=… → tampilkan tombol
 * unduh yang menunjuk LANGSUNG ke tautan Cobalt (tanpa proxy /download, jadi
 * file tidak melewati Vercel).
 *
 * Catatan: media sengaja TIDAK di-preview. Tautan tunnel Cobalt bersifat
 * sekali pakai — menampilkannya lebih dulu di <img> bisa membuat tombol
 * unduhnya gagal.
 */

interface PinterestMedia {
  url: string;
  filename: string;
}

type ApiResponse =
  | ({ ok: true } & PinterestMedia)
  | { ok: false; error: { code: string; message: string } };

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp"]);

/** Tebak jenis media dari ekstensi nama file — hanya untuk label tombol/badge. */
function mediaLabel(filename: string): { kind: string; action: string } {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(filename)?.[1]?.toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.has(ext)) return { kind: "Gambar", action: "Download Gambar" };
  if (ext) return { kind: "Video", action: "Download Video" };
  return { kind: "Media", action: "Download Media" };
}

export default function PinterestDownloaderPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PinterestMedia | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/pinterest?url=${encodeURIComponent(trimmed)}`);

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

      setResult({ url: body.url, filename: body.filename });
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

  function handleReset() {
    setUrl("");
    setError(null);
    setResult(null);
  }

  const label = result ? mediaLabel(result.filename) : null;

  return (
    <div className="container-x max-w-3xl space-y-6">
      <DownloaderBackLink />

      <header className="paper-heading">
        <p className="eyebrow">Alat gratis · Tanpa login</p>
        <h1 className="paper-heading-title font-serif">Pinterest Downloader</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Tempel tautan sebuah pin untuk mengunduh gambar atau videonya dalam kualitas asli. Gratis dan
          tidak perlu akun.
        </p>
      </header>

      {/* ---- Form ---- */}
      <form onSubmit={handleSubmit} className="card p-5" noValidate>
        <label htmlFor="pinterest-url" className="label">
          Link pin Pinterest
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="pinterest-url"
            className="input"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.pinterest.com/pin/… atau https://pin.it/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            aria-describedby="pinterest-url-hint"
          />
          <button type="submit" className="btn-primary sm:flex-none" disabled={loading || !url.trim()}>
            {loading ? (
              <>
                <span
                  className="inline-block size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  aria-hidden
                />
                Memproses…
              </>
            ) : (
              "Proses →"
            )}
          </button>
        </div>
        <p id="pinterest-url-hint" className="hint">
          Mendukung tautan <strong>pinterest.com/pin/</strong> dan <strong>pin.it/</strong> · batas 10
          permintaan per menit per IP.
        </p>
      </form>

      {/* ---- Loading ---- */}
      {loading && (
        <div className="card p-5" aria-busy="true" aria-live="polite">
          <p className="text-sm font-bold">Mengambil media dari Pinterest…</p>
          <div className="mt-4 animate-pulse space-y-2.5">
            <div className="h-4 w-11/12 bg-slate-100" />
            <div className="h-4 w-3/4 bg-slate-100" />
            <div className="h-9 w-1/2 bg-slate-100" />
          </div>
        </div>
      )}

      {/* ---- Error ---- */}
      {error && (
        <div className="alert-error" role="alert">
          {error}
        </div>
      )}

      {/* ---- Hasil ---- */}
      {result && label && (
        <article className="card p-5" aria-live="polite">
          <p className="section-kicker">Selesai</p>
          <h2 className="mt-1 font-serif text-lg font-black leading-snug">{label.kind} siap diunduh</h2>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="badge text-slate-700">{label.kind}</span>
            <span className="break-all text-xs text-slate-500">{result.filename}</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {/* Unduhan LANGSUNG dari Cobalt — tanpa endpoint proxy di server. */}
            <a
              href={result.url}
              download={result.filename}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
              title={`Unduh: ${result.filename}`}
            >
              ↓ {label.action}
            </a>
            <button type="button" className="btn-secondary btn-sm" onClick={handleReset}>
              Unduh pin lain
            </button>
          </div>

          <p className="hint mt-3">
            Tautan terbuka di tab baru dan berlaku sementara. Bila unduhan tidak mulai otomatis: tekan lama
            (HP) atau klik kanan (komputer) lalu pilih <em>“Simpan tautan/gambarnya”</em>.
          </p>
        </article>
      )}

      {/* ---- Keadaan awal ---- */}
      {!loading && !error && !result && (
        <p className="paper-empty p-4 text-sm leading-6 text-slate-500">
          Belum ada yang diproses. Salin tautan pin dari tombol <strong>Bagikan</strong> di Pinterest, tempel
          di kolom atas, lalu tekan <strong>Proses</strong>.
        </p>
      )}

      {/* ---- Catatan ---- */}
      <section className="paper-inset flex items-start gap-3 p-4 sm:p-5">
        <span
          className="grid size-9 flex-none place-items-center border border-slate-900 bg-slate-900 font-serif text-sm font-black text-white"
          aria-hidden
        >
          !
        </span>
        <p className="text-sm leading-6 text-slate-600">
          <strong className="text-slate-900">Gunakan dengan bijak.</strong> Unduh hanya konten milikmu sendiri
          atau yang kamu punya izinnya. Hak cipta tetap milik pembuatnya — ini bukan alat untuk
          mendistribusikan ulang karya orang lain.
        </p>
      </section>
    </div>
  );
}
