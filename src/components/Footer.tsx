import Link from "next/link";
import { getAuthContext, isAdmin } from "@/lib/authz";

/** Footer publik (server component). Link akun menyesuaikan status login:
 *  tamu melihat masuk/daftar, user login melihat pesanan/dashboard — bukan
 *  link "daftar" yang cuma memantul kembali (halaman auth khusus tamu). */
export async function Footer() {
  const ctx = await getAuthContext();

  return (
    <footer className="site-footer">
      <div className="container-x grid gap-8 py-8 sm:grid-cols-[1.4fr_0.8fr_0.8fr]">
        <div>
          <p className="site-footer-masthead">Kabar Toko</p>
          <p className="site-footer-copy mt-2 max-w-sm">
            Belanja ringkas dengan rasa koran pagi: pilih produk, selesaikan transfer manual lewat
            WhatsApp bersama penjual, lalu biarkan penjual mengabarkan pesananmu.
          </p>
        </div>
        <div>
          <p className="site-footer-heading">Jelajahi</p>
          <div className="mt-2 grid gap-1.5">
            <Link href="/" className="site-footer-link">
              Beranda
            </Link>
            <Link href="/products" className="site-footer-link">
              Katalog produk
            </Link>
            <Link href="/testimoni" className="site-footer-link">
              Testimoni pembeli
            </Link>
            <Link href="/orders" className="site-footer-link">
              Pesanan saya
            </Link>
          </div>
        </div>
        <div>
          <p className="site-footer-heading">{ctx ? "Akun kamu" : "Bantuan akun"}</p>
          <div className="mt-2 grid gap-1.5">
            {ctx ? (
              <>
                <Link href="/orders" className="site-footer-link">
                  Pesanan saya
                </Link>
                {isAdmin(ctx) && (
                  <Link href="/admin" className="site-footer-link">
                    Dashboard penjual
                  </Link>
                )}
              </>
            ) : (
              <>
                <Link href="/auth/login" className="site-footer-link">
                  Masuk
                </Link>
                <Link href="/auth/register" className="site-footer-link">
                  Buat akun
                </Link>
                <Link href="/auth/forgot-password" className="site-footer-link">
                  Lupa password
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="site-footer-bottom">
        <div className="container-x flex flex-wrap items-center justify-between gap-2 py-3">
          <span>Pembayaran transfer manual via WhatsApp</span>
          <span>Pesanan dikonfirmasi penjual melalui WhatsApp</span>
        </div>
      </div>
    </footer>
  );
}
