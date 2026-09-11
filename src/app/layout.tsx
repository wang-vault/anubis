import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

// Semua halaman bersifat dinamis (header menampilkan state login per-user).
// Kecepatan tetap terjaga lewat unstable_cache pada query katalog (60 dtk)
// dan rendering ringan tanpa data besar.
export const dynamic = "force-dynamic";

const siteName = process.env.NEXT_PUBLIC_SITE_NAME ?? "Toko Saya";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: `${siteName} — beli, bayar QRIS, pesanan diantar via WhatsApp`,
    template: `%s — ${siteName}`,
  },
  description:
    "Toko online sederhana: bayar QRIS otomatis terverifikasi, pesanan diproses penjual, dan dikirim lewat WhatsApp.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#16a34a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="flex min-h-dvh flex-col">
        <Header />
        <main className="flex-1 py-6">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
