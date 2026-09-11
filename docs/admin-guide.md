# Manual Pemilik Toko / Penjual (setelah deploy)

Cukup browser + dashboard Vercel + Supabase + Telegram. Tidak ada server yang
harus Anda sentuh.

## A. Login admin
1. Buka `https://tokoanda.com/admin/login`.
2. Email + password akun yang sudah diberi `role='admin'`
   (cara penetapan pertama: `docs/deployment.md` §D5; menambah admin kedua:
   daftarkan user biasa → SQL `update profiles set role='admin' where email='…'`).
3. Salah akun → muncul "bukan akun penjual". Login buyer biasa tidak akan
   pernah bisa masuk dashboard (role dicek di server).

## B. Membuat produk
1. Menu **Produk → + Tambah Produk**.
2. Isi: nama, deskripsi, **harga Rupiah utuh** (ketik `25000`, bukan `25.000`
   atau `25,000`), URL gambar https (upload dulu ke hosting gambar;
   rasio 4:3 bagus; kosong = ikon kotak), centang **Aktif**.
3. Simpan → langsung tampil di katalog (cache 60 detik, atau detik itu juga
   setelah aksi admin).
Catatan gambar: gunakan URL https yang bisa diakses publik (mis. upload ke
CDN/Drive direct link Anda). Format JPG/WebP ±200 KB agar cepat di HP.

## C. Mengubah harga
Produk → **Edit** → ganti harga → Simpan.
Harga baru hanya berlaku untuk **order berikutnya**. Order lama tetap memakai
harga snapshot — jadi Anda bebas koreksi harga kapan pun tanpa merusak histori.

## D. Menonaktifkan produk
Tombol **Nonaktifkan** di daftar produk = `is_active=false`:
hilang dari katalog, tidak bisa di-checkout, order/produk tetap aman.
**Aktifkan** mengembalikannya. (Hapus produk permanen tidak disediakan dari UI —
sengaja, agar histori FK tidak rusak.)

## E. Melihat order
Menu **Order**. Tab filter (Semua/Belum Bayar/Perlu Diproses/Diproses/
Selesai/Expired) + pencarian (kode order, nama buyer, produk — min 3 huruf).
Tiap kartu menampilkan: kode, badge pembayaran+status, produk×jumlah, total,
buyer + WA, waktu, status notifikasi Telegram, tombol aksi.

## F. Status PENDING
= order dibuat, **belum ada pembayaran terverifikasi**.
- Bukan berarti buyer tidak bayar — webhook bisa telat beberapa menit.
- Anda bisa tekan **⟳ Cek Pembayaran** (menanyakan status langsung ke
  YoBasePay; maks 1x/10 detik). Bila ternyata lunas → otomatis PAID.
- Order tak terbayar kedaluwarsa sendiri pada `payment_expired_at` → menjadi
  **EXPIRED**; atau tekan **✕ Expire** untuk membatalkan order mati lebih awal.

## G. Status PAID
= uang terverifikasi (webhook/polling). Jangan pernah menandai lunas manual —
tidak ada tombolnya, dan memang begitu seharusnya. Order PAID masuk antrian
**🔔 Perlu diproses** di Ringkasan.

## H. Memproses order
1. Dari kartu order (atau halaman Detail): klik **▶ Proses Pesanan** → status
   `PROCESSING` (buyer melihat "pesanan diproses" di halaman Lacak).
2. (Opsional) Konfirmasi stok/catatan via chat.
3. Setelah barang dikirim: **✓ Tandai Selesai** → `DONE`.
Bisa langsung **Selesai** dari `PAID` bila penjualannya instan (produk digital
dsb) — alur sengaja longgar untuk kecepatan.

## I. Membuka WhatsApp buyer
Tombol **💬 Chat WhatsApp** = link `wa.me/628…` dengan pesan template otomatis
(nama + kode order). Nomor yang dipakai = **snapshot saat order dibuat** — kalau
buyer belakangan ganti nomor, gunakan nomor "kontak akun saat ini" yang
ditampilkan detail order (ada penanda ⚠ bila berbeda).

## J. Mengirim pesanan
Manual: transfer barang/isi pesan digital via chat. Sistem dengan sengaja TIDAK
mengirim otomatis (tidak ada WhatsApp API di sini) — Anda yang pegang kendali.
Bila buyer mengirim bukti transfer: jangan ubah status — status sudah PAID dari
sistem sejak uang masuk (cek mutasi YoBasePay bila ragu).

## K. Menandai DONE
Klik **✓ Tandai Selesai** (di list atau detail). Pembatalan status DONE tidak
disediakan; kalau salah tekan, catat di pesan buyer. Dashboard ringkasan:
"Selesai hari ini" & "Revenue bulan ini" ikut berubah.

## L. Order EXPIRED
Buyer belum bayar sampai batas. Penjelasan ke buyer: silakan order ulang.
Order expired dibiarkan sebagai histori (bisa dicari). Tidak ada biaya.

## M. Pembayaran bermasalah
| Gejala | Langkah |
|---|---|
| Buyer yakin sudah bayar, order masih PENDING | Tekan **⟳ Cek Pembayaran**. Kalau tetap PENDING: cek mutasi/saldo YoBasePay (dashboard) — apakah dana masuk? Nomor trx buyer → cocok dengan `payment_id` order di detail? |
| Nominal beda (kurang/lebih) | Sistem TIDAK akan melunaskan sendiri (validasi toleransi). Dana kurang → minta buyer top-up order baru / Anda koreksi manual. Dana lebih → atur via YoBasePay/refund manual. Catatan: `webhook_amount_invalid` di log. |
| Webhook YoBasePay gagal total | Pembayaran tetap bisa sinkron lewat tombol cek (API privat). Tanyakan status kirim ke YoBasePay; cek log `webhook_received`. |
| Dana masuk tapi order dibatalkan (telat) | Webhook PAID akan menyalakan lagi order EXPIRED→PAID; kirim pesan ke buyer. |

## N. Mengecek log
Vercel → Project → **Observability/Logs** (atau Deployments → … → Runtime logs).
Filter yang berguna: `order_created`, `order_paid`, `webhook_received`,
`webhook_signature_invalid`, `telegram_notify_failed`, `payment_create_failed`.
Log adalah JSON satu baris; tidak memuat secret.

## O. Notifikasi Telegram
Tiap order PAID → pesan `🔔 PESANAN BARU …` (buyer, WA, produk, jumlah, total).
- Tidak masuk? Cek `TELEGRAM_BOT_TOKEN/CHAT_ID` (deploy ulang setelah ubah),
  test kirim manual per `docs/telegram.md` §4, lalu cari `telegram_send_*` di log.
- Field "🔔 dinotifikasi" di kartu order = bukti sistem sudah mencoba kirim
  (satu kali per order — tidak dobel).
- Chat ID diganti (mis. pindah grup) → ubah env + redeploy; selesai.

## Harian Mingguan Bulanan
- Harian: buka Ringkasan → kerjakan antrian "Perlu diproses"; balas chat buyer.
- Mingguan: cek stok vs produk (nonaktifkan yang habis), cek revenue bulan ini.
- Bulanan: rekap Supabase (Table Editor → export orders), pastikan backup,
  rotasi API key bila perlu (YoBasePay/Supabase/Telegram — update env, redeploy),
  jalankan ulang `docs/testing.md` setelah upgrade dependensi.
