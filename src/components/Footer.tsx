import Link from "next/link";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container-x grid gap-8 py-8 sm:grid-cols-[1.4fr_0.8fr_0.8fr]">
        <div>
          <p className="site-footer-masthead">Kabar Toko</p>
          <p className="site-footer-copy mt-2 max-w-sm">
            Belanja ringkas dengan rasa koran pagi: pilih produk, pilih cara bayar (transfer manual atau
            QRIS otomatis bila tersedia), lalu biarkan penjual mengabarkan pesananmu lewat WhatsApp.
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
            <Link href="/orders" className="site-footer-link">
              Pesanan saya
            </Link>
          </div>
        </div>
        <div>
          <p className="site-footer-heading">Bantuan akun</p>
          <div className="mt-2 grid gap-1.5">
            <Link href="/auth/login" className="site-footer-link">
              Masuk
            </Link>
            <Link href="/auth/register" className="site-footer-link">
              Buat akun
            </Link>
            <Link href="/auth/forgot-password" className="site-footer-link">
              Lupa password
            </Link>
          </div>
        </div>
      </div>
      <div className="site-footer-bottom">
        <div className="container-x flex flex-wrap items-center justify-between gap-2 py-3">
          <span>Pembayaran via Transfer Manual · QRIS Otomatis (bila tersedia)</span>
          <span>Pesanan dikonfirmasi penjual melalui WhatsApp</span>
        </div>
      </div>
    </footer>
  );
}
