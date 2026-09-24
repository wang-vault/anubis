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

## B2. Mencari produk di daftar (dashboard)
Di **Produk** ada kotak **Cari produk** di kanan judul:
1. Ketik kata kunci (minimal **2 huruf**) → **Cari**/Enter.
2. Nama, deskripsi, dan harga ikut dicari; kata yang cocok disorot, dan
   deskripsi ringkas muncul sebagai keterangan.
3. Hasilnya juga menyebut jumlahnya, mis. "3 dari 16 produk cocok dengan 'kopi'".
4. Produk **nonaktif** tetap ikut ditemukan (katalog pembeli tidak menampilkannya).
5. Tekan **Hapus** untuk kembali ke daftar penuh. Menonaktifkan/mengaktifkan
   produk dari hasil pencarian membawa Anda kembali ke hasil yang sama.
Mesin pencariannya sama dengan katalog pembeli (`?q=…`, tanpa akses DB tambahan).

## C. Mengubah harga
Produk → **Edit** → ganti harga → Simpan.
Harga baru hanya berlaku untuk **order berikutnya**. Order lama tetap memakai
harga snapshot — jadi Anda bebas koreksi harga kapan pun tanpa merusak histori.

## D. Menonaktifkan atau menghapus produk
Tombol **Nonaktifkan** di daftar produk = `is_active=false`:
hilang dari katalog, tidak bisa di-checkout, order/produk tetap aman.
**Aktifkan** mengembalikannya.

Hapus permanen: **Produk → Edit → Hapus Produk**. Browser meminta konfirmasi
("Yakin hapus produk ini? Tindakan tidak bisa dibatalkan."). Berhasil → kembali
ke daftar dengan pesan produk terhapus. Ditolak bila masih ada pesanan aktif
(status bukan cancelled/refunded) — order lama menyimpan snapshot harga, tetapi
baris order tetap mereferensi produk (`on delete restrict`).

## E. Melihat order
Menu **Order**. Tab filter (Semua/**Verifikasi Manual**/Belum Bayar/Perlu
Diproses/Diproses/Selesai/Expired) + pencarian (kode order, nama buyer, produk
— min 3 huruf). Tab **Verifikasi Manual** = antrian order transfer manual yang
sudah diklaim buyer dan menunggu kamu cek mutasi (`/admin/orders?status=CLAIM`).
Tiap kartu menampilkan: kode, badge pembayaran+status, produk×jumlah, total,
buyer + WA, waktu, status notifikasi Telegram, tombol aksi.

## F. Status PENDING
= order dibuat, **belum ada pembayaran yang kamu verifikasi**.
- Bukan berarti buyer tidak bayar — buyer biasanya baru saja chat dan transfer;
  cek antrian **Verifikasi Manual** (§P) sebelum menyimpulkan apa pun.
- Tidak ada tombol "cek ke provider": toko ini tidak punya provider. Satu-satunya
  cara order jadi PAID adalah verifikasi mutasi olehmu.
- Order yang **belum diklaim** buyer kedaluwarsa sendiri pada
  `payment_expired_at` (default 120 menit) → **EXPIRED**; atau tekan **✕ Expire**
  untuk membatalkan order mati lebih awal.
- Order yang **sudah diklaim** tidak pernah kedaluwarsa otomatis — keputusan ada
  di kamu (konfirmasi atau tolak).

## G. Status PAID
= uang terverifikasi. Hanya ada satu jalur: **konfirmasi kamu** setelah melihat
mutasi (§P). Tidak ada tombol "tandai lunas" instan dan buyer tidak punya jalur
apa pun untuk melunasi ordernya sendiri — memang begitu seharusnya. Order PAID
masuk antrian **🔔 Perlu diproses** di Ringkasan.

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
Bila buyer mengirim bukti transfer di chat: simpan sebagai arsip, tetapi **status
hanya berubah dari keputusanmu** di dashboard — cek mutasi, lalu konfirmasi (§P).

## K. Menandai DONE
Klik **✓ Tandai Selesai** (di list atau detail). Pembatalan status DONE tidak
disediakan; kalau salah tekan, catat di pesan buyer. Dashboard ringkasan:
"Selesai hari ini" & "Revenue bulan ini" ikut berubah.

## L. Order EXPIRED
Buyer belum bayar sampai batas. Penjelasan ke buyer: silakan order ulang.
Order expired dibiarkan sebagai histori (bisa dicari). Tidak ada biaya.

## M. Pembayaran bermasalah (transfer manual)
Tidak ada provider, jadi semua penyelesaian lewat mutasi + chat.

| Gejala | Langkah |
|---|---|
| Buyer bilang sudah transfer, order masih PENDING | Cek antrian **Verifikasi Manual**. Cocokkan nominal (total + 3 digit kode unik), waktu, dan nama pengirim di mutasi. Ketemu → **✓ Konfirmasi Lunas** |
| Uang masuk tapi buyer belum menekan "Saya sudah transfer" | Order tidak muncul di antrian. Buka detail order (tautan kode dari chat) → konfirmasi langsung dari sana, atau minta buyer menekan tombolnya |
| Nominal kurang | Jangan konfirmasi. Isi *nominal masuk* yang benar → sistem menolak (409) bila kurang dari total. Balas chat: minta transfer sisa |
| Nominal lebih (buyer salah ketik) | Konfirmasi tetap boleh **bila** kelebihannya wajar/sudah kamu sepakati; catat di catatan verifikasi. Kalau ragu, tolak dulu lalu sepakati di chat |
| Buyer salah transfer ke rekening lama | Detail pembayaran selalu dikirim ulang di chat — minta buyer chat lagi dan kirim nomor terbaru |
| Order sudah EXPIRED padahal buyer sudah transfer | Buka **detail order** → **✓ Konfirmasi Pembayaran Lunas** (nominal ditagihkan tertera di sana) → order kembali `PAID`. Alternatifnya buat order baru, asalkan buyer **tidak ditagih dua kali** |
| Buyer menekan "sudah transfer" tanpa transfer | **✕ Tolak Klaim** + alasan singkat. Buyer boleh konfirmasi ulang; status tetap PENDING |
| Order lama berlabel "QRIS Otomatis (lama)" | Order arsip dari masa provider. Tidak bisa dikonfirmasi lewat jalur manual (409) — kalau uangnya memang masuk, catat manual di luar sistem |

## N. Mengecek log
Vercel → Project → **Observability/Logs** (atau Deployments → … → Runtime logs).
Filter yang berguna: `order_created`, `order_paid`, `manual_claim_received`,
`manual_payment_confirmed`, `manual_claim_rejected`, `order_expired`,
`manual_payment_unavailable`, `store_schema_outdated`, `telegram_notify_failed`.
Log adalah JSON satu baris; tidak memuat secret.

## O. Notifikasi Telegram
Tiap order PAID → pesan `🔔 PESANAN BARU …` (buyer, WA, produk, jumlah, total).
- Tidak masuk? Cek `TELEGRAM_BOT_TOKEN/CHAT_ID` (deploy ulang setelah ubah),
  test kirim manual per `docs/telegram.md` §4, lalu cari `telegram_send_*` di log.
- Field "🔔 dinotifikasi" di kartu order = bukti sistem sudah mencoba kirim
  (satu kali per order — tidak dobel).
- Chat ID diganti (mis. pindah grup) → ubah env + redeploy; selesai.

## P. Pembayaran manual via WhatsApp (satu-satunya metode)
Tidak ada payment gateway dan tidak ada pilihan metode di checkout: setiap
order dibuat sebagai transfer manual, dan **semua detail pembayaran kamu kirim
lewat chat WhatsApp** (QRIS statis, nomor rekening, atau e-wallet — bebas, bisa
kamu ganti kapan saja). Panduan lengkap: **`docs/manual-payment.md`**.

**Setup sekali**: menu **Pembayaran** (`/admin/settings`) → isi **nomor WhatsApp
penjual** (wajib; format `081234567890` atau `+62 812…`) → opsional: nama
penerima, batas waktu bayar (10–4320 menit, default 120), nama metode,
instruksi tambahan, dan template pesan WhatsApp → **Simpan**. Tanpa deploy
ulang. Selama nomor belum diisi, checkout menolak order dengan pesan jelas.

Panel **Status saat ini** menjelaskan kesiapan metode:

| Status | Artinya | Tindakan |
|---|---|---|
| siap | saklar aktif + nomor WA terisi | — |
| `no_whatsapp` | nomor WA masih kosong | isi nomor di form (atau set `WHATSAPP_SELLER_NUMBER`) |
| `disabled` | saklar di DB mati, atau env `MANUAL_PAYMENT_ENABLED=false` | nyalakan salah satunya |
| `schema_missing` | kolom pembayaran manual / kolom WhatsApp belum ada | jalankan `supabase/store/002_manual_payment.sql` lalu `004_whatsapp_payment.sql` — banner merah di `/admin` memuat SQL-nya |

**Template pesan WhatsApp** yang kosong memakai template bawaan (kode order,
produk, jumlah, dan nominal tagihan). Placeholder yang tersedia: `{toko}`
`{kode}` `{produk}` `{jumlah}` `{total}` `{nama}`.

**Harian (verifikasi)**:
1. Telegram mengirim **🧾 KLAIM TRANSFER MANUAL** (order, nominal ditagihkan,
   nama pengirim, no. referensi).
2. Buka mutasi QRIS/rekeningmu → cari nominal itu (perhatikan **3 digit kode
   unik**, mis. Rp50.417, dan nama pengirim).
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
  rotasi kredensial bila perlu (Supabase/Telegram — update env, redeploy),
  jalankan ulang `docs/testing.md` setelah upgrade dependensi.
