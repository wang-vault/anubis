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
Menu **Order**. Tab filter (Semua/**Verifikasi Manual**/Belum Bayar/Perlu
Diproses/Diproses/Selesai/Expired) + pencarian (kode order, nama buyer, produk
— min 3 huruf). Tab **Verifikasi Manual** = antrian order transfer manual yang
sudah diklaim buyer dan menunggu kamu cek mutasi (`/admin/orders?status=CLAIM`).
Tiap kartu menampilkan: kode, badge pembayaran+status, produk×jumlah, total,
buyer + WA, waktu, status notifikasi Telegram, tombol aksi.

## F. Status PENDING
= order dibuat, **belum ada pembayaran terverifikasi**.
- Bukan berarti buyer tidak bayar — webhook bisa telat beberapa menit.
- Order **QRIS otomatis**: tekan **⟳ Cek Pembayaran** (menanyakan status
  langsung ke YoBasePay; maks 1x/10 detik). Bila ternyata lunas → otomatis PAID.
- Order **transfer manual**: tombol cek provider tidak ada (memang tidak ada
  provider). Order baru berubah setelah kamu memverifikasi mutasi — lihat §P.
- Order tak terbayar kedaluwarsa sendiri pada `payment_expired_at` → menjadi
  **EXPIRED**; atau tekan **✕ Expire** untuk membatalkan order mati lebih awal.

## G. Status PAID
= uang terverifikasi: webhook/polling untuk QRIS otomatis, atau **konfirmasi
kamu** untuk pembayaran manual (§P). Di luar dua jalur itu tidak ada tombol
"tandai lunas" — memang begitu seharusnya. Order PAID masuk antrian
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

## M. Pembayaran bermasalah (QRIS otomatis)
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

## P. Pembayaran manual (QRIS statis milikmu)
Metode kedua selain QRIS otomatis — dipakai saat QRIS provider belum aktif atau
kamu ingin dana masuk langsung ke QRIS merchant sendiri (mis. GoPay Merchant).
Panduan lengkap: **`docs/manual-payment.md`**.

**Setup sekali**: menu **Pembayaran** (`/admin/settings`) → aktifkan metode →
unggah gambar QRIS statis (PNG/JPG/WebP, maks 900 KB) → isi nama penerima &
batas waktu bayar → **Simpan**. Gambar disimpan di database toko (bukan bucket),
diganti kapan pun tanpa deploy ulang.

Di panel **Status saat ini** kamu akan melihat dua baris: "Transfer Manual
(QRIS statis)" (✓ tampil di checkout / ✗ dengan alasan `no_qr`/`disabled`) dan
"QRIS Otomatis (YoBasePay)" yang mengikuti env. **Terisi** → "dapat dipilih
pembeli di halaman checkout" (berdampingan dengan Transfer Manual, yang tetap
jadi default). **Kosong** → **ONGOING**: di checkout opsinya ber-badge
"Ongoing", tidak bisa dipilih buyer, dan semua pembelian mengalir ke Transfer
Manual. Untuk membukanya: isi `YOBASEPAY_API_KEY` +
`YOBASEPAY_WEBHOOK_SECRET` lalu redeploy — tidak ada perubahan kode.

**Harian (verifikasi)**:
1. Telegram mengirim **🧾 KLAIM TRANSFER MANUAL** (order, nominal ditagihkan,
   nama pengirim, no. referensi).
2. Buka mutasi QRIS-mu → cari nominal itu (perhatikan **3 digit kode unik**,
   mis. Rp50.417, dan nama pengirim).
3. Uang ada → **✓ Konfirmasi Lunas** (di kartu order atau tab *Verifikasi
   Manual*). Detail order menyediakan kolom **nominal masuk** + catatan
   verifikasi; nominal kurang dari total order akan ditolak sistem.
4. Uang tidak ada → **✕ Tolak Klaim** + alasan (buyer melihat alasan itu dan
   boleh konfirmasi ulang sampai batas waktu habis).
5. Order jadi PAID → Telegram **🔔 PESANAN BARU** → proses seperti §H.

**Yang perlu diingat**: klaim buyer **bukan** bukti pembayaran — tidak ada
rekonsiliasi otomatis di metode ini. Selama buyer sudah mengklaim, order tidak
di-expire otomatis (keputusan ada di kamu). Kartu **Perlu verifikasi** di
Ringkasan menampilkan jumlah antrian.

## Harian Mingguan Bulanan
- Harian: buka Ringkasan → kerjakan antrian "Perlu verifikasi" (transfer
  manual) lalu "Perlu diproses"; balas chat buyer.
- Mingguan: cek stok vs produk (nonaktifkan yang habis), cek revenue bulan ini.
- Bulanan: rekap Supabase (Table Editor → export orders), pastikan backup,
  rotasi API key bila perlu (YoBasePay/Supabase/Telegram — update env, redeploy),
  jalankan ulang `docs/testing.md` setelah upgrade dependensi.
