import type { Metadata } from "next";

/**
 * Metadata halaman /audio (Audio Extractor).
 *
 * Terpisah di layout karena src/app/audio/page.tsx adalah Client Component
 * ("use client") — Next.js menolak `export const metadata` di file klien, jadi
 * judul/deskripsinya dipasang di layout server ini (pola yang sama dengan
 * halaman server lain, mis. /downloader). Judul otomatis memakai template
 * root layout: "Audio Extractor — <nama toko>".
 */
export const metadata: Metadata = {
  title: "Audio Extractor",
  description: "Ekstrak audio dari video YouTube dalam format MP3. Gratis dan tanpa login.",
};

export default function AudioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
