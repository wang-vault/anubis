import Link from "next/link";
import { getAuthContext, isAdmin } from "@/lib/authz";
import { signOutAction } from "@/app/auth/actions";
import { ActionButton } from "@/components/ActionButton";
import { DOWNLOADER_HUB_PATH } from "@/lib/downloaders";

/** Header publik (server component — tanpa client JS). */
export async function Header() {
  const ctx = await getAuthContext();
  const siteName = process.env.NEXT_PUBLIC_SITE_NAME ?? "Toko Saya";

  return (
    <header className="masthead">
      <div className="container-x">
        <div className="masthead-meta">
          <span>Edisi harian · Belanja lokal</span>
          <span className="hidden sm:inline">Bayar transfer manual via WhatsApp · pesanan diantar penjual</span>
        </div>

        <div className="masthead-brand-row">
          <Link href="/" className="masthead-brand-link" aria-label={`${siteName}, kembali ke beranda`}>
            <span className="masthead-monogram" aria-hidden>
              AN
            </span>
            <span className="min-w-0">
              <span className="masthead-wordmark">{siteName}</span>
              <span className="masthead-subtitle">Kabar belanja hari ini</span>
            </span>
          </Link>

          <nav className="masthead-actions" aria-label="Aksi akun">
            {ctx ? (
              <>
                <span className="hidden max-w-32 truncate px-1 text-xs font-bold text-slate-600 sm:inline">
                  {ctx.profile?.name ?? "Akun"}
                </span>
                <form action={signOutAction}>
                  <ActionButton type="submit" className="btn-secondary btn-sm" pendingText="Keluar…">
                    Keluar
                  </ActionButton>
                </form>
              </>
            ) : (
              <>
                <Link href="/auth/login" className="btn-secondary btn-sm">
                  Masuk
                </Link>
                <Link href="/auth/register" className="btn-primary btn-sm">
                  Daftar
                </Link>
              </>
            )}
          </nav>
        </div>

        <nav className="masthead-nav-row" aria-label="Navigasi utama">
          <Link href="/" className="masthead-nav-link">
            Beranda
          </Link>
          <Link href="/products" className="masthead-nav-link">
            Katalog Produk
          </Link>
          <Link href="/testimoni" className="masthead-nav-link">
            Testimoni
          </Link>
          {ctx && (
            <Link href="/orders" className="masthead-nav-link">
              Pesanan Saya
            </Link>
          )}
          {ctx && isAdmin(ctx) && (
            <Link href="/admin" className="masthead-nav-link">
              Dashboard Penjual
            </Link>
          )}
          <span className="ml-auto hidden pr-1 text-[10px] font-bold tracking-[0.16em] text-slate-400 sm:inline">
            Edisi No. 01
          </span>
          {/* SATU tombol untuk semua downloader (TikTok, YouTube, Instagram) →
              halaman pemilih; pengunjung memilih platformnya di sana. Tampil di
              semua halaman (termasuk dashboard penjual). Layar ≥1024 px: ujung
              kanan; di bawahnya: paling depan dari strip navigasi yang bisa
              di-scroll (lihat .masthead-nav-link--tool di globals.css). */}
          <Link href={DOWNLOADER_HUB_PATH} className="masthead-nav-link masthead-nav-link--tool">
            <span className="masthead-nav-icon" aria-hidden>
              ↓
            </span>
            Downloader
          </Link>
        </nav>
      </div>
    </header>
  );
}
