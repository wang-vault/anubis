/**
 * DAFTAR DOWNLOADER (alat gratis publik) — satu sumber kebenaran.
 *
 * Alurnya sengaja satu pintu:
 *   tombol "Downloader" (header · footer · beranda) → halaman pemilih
 *   /downloader → pengunjung memilih TikTok / YouTube / Instagram.
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
    slug: "youtube",
    platform: "YouTube",
    name: "YouTube Downloader",
    href: "/youtube",
    mark: "YT",
    tone: "accent",
    description: "Unduh video atau Shorts YouTube sebagai MP4 (H.264) yang bisa diputar di hampir semua perangkat.",
    features: ["Video", "Shorts", "MP4 H.264"],
    accepts: ["youtube.com/watch", "youtu.be", "youtube.com/shorts"],
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
];
