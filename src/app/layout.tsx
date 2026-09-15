import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { parseSiteUrl } from "@/lib/next-url";

// Semua halaman bersifat dinamis (header menampilkan state login per-user).
// Kecepatan tetap terjaga lewat unstable_cache pada query katalog (60 dtk)
// dan rendering ringan tanpa data besar.
export const dynamic = "force-dynamic";

const siteName = process.env.NEXT_PUBLIC_SITE_NAME ?? "Toko Saya";

export const metadata: Metadata = {
  metadataBase: parseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL),
  title: {
    default: `${siteName} — belanja mudah, bayar transfer manual, pesanan via WhatsApp`,
    template: `%s — ${siteName}`,
  },
  description:
    "Toko online sederhana: bayar via transfer manual mudah (opsi QRIS status ongoing), pesanan diproses penjual, dan dikirim lewat WhatsApp.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#a61e2b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="newspaper-body flex min-h-dvh flex-col">
        <Header />
        <main className="newspaper-main flex-1 py-6">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
