import Link from "next/link";
import { DOWNLOADER_HUB_PATH } from "@/lib/downloaders";

/**
 * Tautan kembali ke halaman pemilih downloader, dipasang di atas setiap
 * halaman downloader (/tiktok, /youtube, /instagram) supaya pengunjung bisa
 * ganti platform tanpa lewat beranda. Tanpa state — aman dipakai di
 * komponen klien maupun server.
 */
export function DownloaderBackLink() {
  return (
    <Link href={DOWNLOADER_HUB_PATH} className="downloader-back-link">
      <span aria-hidden>←</span> Pilih downloader lain
    </Link>
  );
}
