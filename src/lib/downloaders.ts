/**
 * DAFTAR DOWNLOADER (alat gratis publik) — satu sumber kebenaran.
 *
 * Alurnya sengaja satu pintu:
 *   tombol "Downloader" (header · footer · beranda) → halaman pemilih
 *   /downloader → pengunjung memilih platformnya (TikTok, Instagram,
 *   Pinterest, SoundCloud).
 *
 * Halaman lain TIDAK menautkan tiap downloader satu per satu — cukup ke
 * DOWNLOADER_HUB_PATH. Menambah downloader baru = buat halamannya di
 * src/app/<slug>/page.tsx lalu tambahkan satu entri di DOWNLOADERS; halaman
 * pemilih otomatis menampilkan tombolnya (test memastikan halamannya ada).
 *
 * Murni data (tanpa server-only) — aman di-import komponen server maupun klien.
 */

/** Halaman pemilih downloader — satu-satunya tujuan tombol "Downloader". */
export const DOWNLOADER_HUB_PATH = "/downloader";

/** Warna penanda kartu, diambil dari palet koran di globals.css. */
export type DownloaderTone = "ink" | "accent" | "mustard";

export interface DownloaderTool {
  /** ID unik + segmen URL halamannya (mis. "tiktok" → /tiktok). */
  slug: string;
  /** Nama platform, mis. "TikTok". */
  platform: string;
  /** Nama lengkap alat, mis. "TikTok Downloader". */
  name: string;
  /** Halaman downloader-nya. */
  href: string;
  /** Monogram 2 huruf untuk kartu (gaya monogram "AN" di masthead). */
  mark: string;
  tone: DownloaderTone;
  /** Satu kalimat: apa yang bisa diunduh. */
  description: string;
  /** Chip fitur singkat. */
  features: readonly string[];
  /** Bentuk tautan yang diterima (sama dengan validasi di API-nya). */
  accepts: readonly string[];
}

export const DOWNLOADERS: readonly DownloaderTool[] = [
  {
    slug: "tiktok",
    platform: "TikTok",
    name: "TikTok Downloader",
    href: "/tiktok",
    mark: "TT",
    tone: "ink",
    description: "Unduh video TikTok tanpa watermark, dengan watermark, atau ambil audionya saja.",
    features: ["Tanpa watermark", "Dengan watermark", "Audio saja"],
    accepts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
  },
  {
    slug: "instagram",
    platform: "Instagram",
    name: "Instagram Downloader",
    href: "/instagram",
    mark: "IG",
    tone: "mustard",
    description: "Unduh video dari reel atau post Instagram cukup dengan menempel tautannya.",
    features: ["Reel", "Post video"],
    accepts: ["instagram.com/reel", "instagram.com/p"],
  },
  {
    slug: "pinterest",
    platform: "Pinterest",
    name: "Pinterest Downloader",
    href: "/pinterest",
    mark: "PN",
    tone: "accent",
    description: "Unduh gambar atau video dari sebuah pin Pinterest dalam kualitas aslinya.",
    features: ["Gambar pin", "Video pin", "Tautan pin.it"],
    accepts: ["pinterest.com/pin", "pin.it"],
  },
  {
    slug: "soundcloud",
    platform: "SoundCloud",
    name: "SoundCloud Downloader",
    href: "/soundcloud",
    mark: "SC",
    tone: "ink",
    description: "Simpan audio sebuah lagu SoundCloud sebagai berkas MP3 siap putar.",
    features: ["Audio MP3", "Satu lagu per proses"],
    accepts: ["soundcloud.com/artis/judul-lagu"],
  },
];
