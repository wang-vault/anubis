"use client";

import Link from "next/link";

interface Props {
  backHref: string;
}

/** Tombol aksi struk — hanya tampil di layar, disembunyikan saat print (.no-print). */
export function ReceiptActions({ backHref }: Props) {
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3">
      <Link href={backHref} className="btn-secondary btn-sm">
        ← Kembali
      </Link>
      <button type="button" onClick={() => window.print()} className="btn-primary btn-sm">
        🖨️ Cetak / Simpan PDF
      </button>
    </div>
  );
}
