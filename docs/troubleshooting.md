# Troubleshooting

Format tiap kasus: **Penyebab mungkin → Cara mengecek → Solusi.**
Log aplikasi = Vercel → Project → **Observability/Logs** (kata kunci JSON-nya
dicantumkan di bawah).

## 1. "Email verifikasi tidak masuk"
- Penyebab: folder spam; SMTP bawaan Supabase kena rate limit (±2/jam);
  redirect/templat dirusak; user salah ketik email.
- Cek: Supabase #1 → Authentication → **Users** → status user (Unconfirmed?);
  Logs (Auth → Logs) apakah percobaan kirim tercatat; cek spam.
- Solusi: klik **Kirim ulang** di `/auth/verify`; pasang SMTP sendiri
  (Authentication → SMTP, lihat deployment.md §D4); periksa template
  `token_hash` (harus `/auth/callback?...`); email salah → hapus user → daftar ulang.

## 2. "Buyer tidak bisa login"
- Penyebab: email belum diverifikasi (login = "Invalid login credentials"
  bisa termasuk ini); password lupa; rate-limit 8×/5mnt aktif; Supabase
  project salah URL di env.
- Cek: ada user tsb di Auth Users? `email_confirmed_at` terisi? Network tab:
  pesan error apa dari Supabase? env `NEXT_PUBLIC_SUPABASE_ACCOUNT_URL` milik
  project #1 (bukan #2)?
- Solusi: alihkan ke `/auth/verify` (otomatis bila error "Email not confirmed");
  reset password; tunggu limiter; koreksi env → redeploy.

## 3. "Produk tidak muncul"
- Penyebab: `is_active=false`; SQL schema #2 belum dijalankan; env STORE_*
  salah project; cache 60 dtk belum lewat (setelah admin ubah — harusnya
  otomatis via revalidateTag).
- Cek: Supabase #2 → Table Editor → Products; curl
  `https://<ref2>.supabase.co/rest/v1/products?select=name,is_active`
  dengan anon #2 → data keluar? Vercel log `products_list_failed`.
- Solusi: aktifkan produk; jalankan schema; betulkan env pair; hard-refresh
  1–2 menit.

## 4. "Halaman pembayaran tidak menampilkan tombol WhatsApp"

Toko ini tidak menampilkan gambar QR atau nomor rekening di aplikasi — detail
pembayaran selalu dikirim penjual lewat chat. Jadi yang perlu dicek cuma apakah
tombol **💬 Buka WhatsApp Penjual** muncul di `/pay/[code]`.

- **Penyebab**: nomor WhatsApp penjual belum diatur (kolom DB kosong dan
  `WHATSAPP_SELLER_NUMBER` juga kosong), saklar metode mati, atau database belum
  dimigrasi (`schema_missing`).
- **Cek**: `/admin/settings` → panel **Status saat ini** menyebut alasannya:
  * `no_whatsapp` = nomor belum diisi,
  * `disabled` = saklar DB mati atau `MANUAL_PAYMENT_ENABLED=false`,
  * `schema_missing` = kolom WhatsApp / kolom pembayaran manual belum ada.
  Vercel log: `manual_payment_unavailable` (field `reason`).
- **Solusi**: isi nomor di `/admin/settings` → Simpan (tanpa deploy) — atau isi
  `WHATSAPP_SELLER_NUMBER` lalu redeploy. Untuk `schema_missing`, jalankan SQL
  dari banner merah di `/admin`.
- Order yang **sudah** dibuat sebelum nomor diisi tetap bisa dibuka di
  `/pay/[code]`; tombolnya muncul begitu pengaturan tersimpan (muat ulang
  halaman).

## 5. "Buyer bilang sudah transfer tapi order masih PENDING"
- **Ini normal** — status PAID hanya lahir dari verifikasi penjual. Klaim buyer
  hanya memindahkan order ke antrian (`manual_claim_at` terisi).
- **Cek**: `/admin` → kartu **Perlu verifikasi**, atau
  `/admin/orders?status=CLAIM`. Cocokkan di mutasi: nominal **persis**
  (total + 3 digit kode unik), waktu, dan nama pengirim.
- **Solusi**: uang ada → **✓ Konfirmasi Lunas** (isi *nominal masuk* bila
  berbeda). Tombol ini selalu tersedia untuk order manual yang belum lunas —
  **termasuk** order yang belum pernah diklaim buyer dan order yang sudah
  kadaluarsa (§13). Uang tidak ada → **✕ Tolak Klaim** + alasan; buyer boleh
  konfirmasi ulang. Bila buyer **belum** menekan tombol konfirmasi, order tidak
  muncul di antrian — buka detail order dari kode yang dikirim buyer, atau minta
  buyer menekan tombolnya.
- Nominal kurang? Sistem menolak konfirmasi (409) bila *nominal masuk* < total.
  Balas chat: minta selisihnya.
- Telegram tidak mengirim "🧾 KLAIM TRANSFER MANUAL"? Lihat §8 — kegagalan
  kirim tidak membatalkan klaim, antrian di dashboard tetap ada.

## 6–7. Endpoint provider lama (webhook/QR) — sudah dihapus

Sejak pembayaran jadi manual via WhatsApp, **tidak ada** endpoint
`/api/webhooks/stenly`, `/api/manual-qr`, maupun `/api/admin/payments/diagnose`.
Permintaan ke sana sekarang **404**, dan tidak ada webhook yang perlu
dikonfigurasi di mana pun.

- **Kalau dashboard provider lama masih mengirim webhook** → matikan callback di
  sana (kalau tidak, provider akan terus retry dan menerima 404). Order lama
  tetap aman; tidak ada satu baris pun yang bergantung pada webhook itu lagi.
- **Kalau kamu memakai QRIS statis (QR GoPay Merchant dll.)** → tidak ada
  endpoint yang perlu dijaga; QR dikirim penjual lewat chat.
- **Env provider lama** (`STENLY_*`, `DEFAULT_PAYMENT_METHOD`,
  `MANUAL_PAYMENT_QR_IMAGE_URL`) tidak dibaca kode — hapus saja dari Vercel.

## 8. "Telegram tidak menerima notifikasi"
- Penyebab: token/chat ID kosong/salah; bot di-kick; chat ID grup berubah;
  user lupa `/start` ke bot pribadi; deploy belum ulang setelah env berubah;
  order `telegram_notified_at` sudah terisi (sengaja, tidak dobel).
- Cek: `curl` sendMessage manual (telegram.md §4); Supabase: kolom notifikasi.
- Solusi: betulkan env → Redeploy; `/start`; kembalikan bot ke grup; bila order
  sudah PAID tanpa notif: kirim manual dari info order (atau reset kolom +
  trigger ulang status via tombol cek pembayaran — order sudah PAID jadi
  percobaan notif tidak terulang; gunakan data order di dashboard).

## 9. "Admin tidak bisa melihat order"
- Penyebab: akun tidak benar-benar `role=admin`; login pakai akun buyer di
  tab lain (cookie); SQL #1 belum dijalankan (profiles kosong → role null).
- Cek: SQL #1: `select role from profiles where email='…'`; DevTools→Cookies
  ada `sb-<ref1>-auth-token`?
- Solusi: set role via SQL; logout-total lalu login ulang; jalankan schema #1.

## 10. "Buyer bisa melihat order orang lain" ⚠ (seharusnya mustahil)
- Penyebab yang *mungkin*: schema store #2 belum dijalankan (RLS off!),
  atau endpoint custom dibuat sendiri, atau service key bocor ke klien.
- Cek: `select relrowsecurity from pg_class where relname='orders'` → **harus
  true**; coba `curl '…/rest/v1/orders?select=*' -H "apikey:<STORE_ANON>"` →
  401/[]; audit `.next/static` apakah service_role ter-bundle (harus tidak).
- Solusi: jalankan ulang 001_schema.sql #2 (idempoten); kalau service key pernah
  masuk repo: **rotasi semua key** Supabase + token Telegram, tambah admin baru,
  review riwayat order untuk mutasi asing.

## 11. "Vercel deployment error"
- Build gagal `Konfigurasi environment tidak valid` → var wajib belum ada di
  scope Production (atau salah eja) — isi → Deploy ulang.
- `error:0308010C digital envelope` / npm errors → cache: redeploy dengan
  "Clear build cache".
- Runtime 500 semua halaman → env Production vs Preview beda; cek
  `Settings → Environment Variables` (harus Production scope).
- Middleware 500 → `NEXT_PUBLIC_SUPABASE_ACCOUNT_URL` kosong saat runtime
  (middleware pakai var publik tsb).

## 12. "Environment variable tidak terbaca"
- Penyebab: dibuat tanpa scope Production; ditambahkan tapi tidak redeploy;
  prefix NEXT_PUBLIC_ lupa dihapus/ditambah salah arah; ada spasi/kutip
  tersembunyi saat paste.
- Cek: Vercel → Settings → Environment Variables → kolom **Environment** harus
  Production (+Preview); Build log → "Environments Variables" tidak menampilkan
  nilai (normal) tapi build sukses berarti terbaca.
- Solusi: hapus → tulis ulang (tanpa spasi) → **Redeploy**.

## 13. Status order macet / tombol tidak muncul
- `PAID` tanpa tombol Proses? seharusnya selalu ada; cek `payment_status` —
  tombol butuh PAID di keduanya. `PROCESSING` tanpa Selesai = normal (ada).
- Transisi 409: dua orang admin membuka halaman sama — refresh.
- Order `PENDING` permanen: pengecekan kadaluarsa hanya jalan saat status
  dibaca (halaman bayar / dashboard) — tidak ada cron. Buka `/pay/[code]` atau
  tekan **✕ Expire** di dashboard untuk membersihkannya, atau biarkan (tidak
  mengganggu apa pun). Order yang **sudah diklaim** buyer sengaja tidak
  di-expire otomatis.

## 14. Data Supabase penuh kuota / rest rate limit
- Cek: Settings → Infrastructure usage. Solusi: upgrade paket, aktifkan
  `unstable_cache` (sudah on), pertimbangkan read replica — di luar MVP.

## 15. Checkout berkata "Pembayaran belum tersedia"
- **Artinya** salah satu syarat metode belum terpenuhi: saklar DB mati,
  `MANUAL_PAYMENT_ENABLED=false`, nomor WhatsApp belum diisi, atau database
  belum dimigrasi.
- **Cek**: `/admin/settings` → panel **Status saat ini** menyebut alasannya
  (`no_whatsapp` / `disabled` / `schema_missing`). Vercel log:
  `manual_payment_unavailable` + `reason`; saat migrasi belum jalan:
  `store_schema_outdated`.
- **Solusi**: isi **nomor WhatsApp penjual** di `/admin/settings` → Simpan
  (tanpa deploy). Bila `disabled`: nyalakan saklar, dan pastikan
  `MANUAL_PAYMENT_ENABLED` bukan `false` di Vercel (ubah env → redeploy). Bila
  `schema_missing`: jalankan SQL dari banner merah di `/admin`
  (`002_manual_payment.sql` lalu `004_whatsapp_payment.sql`).

## 15b. Banner merah "Database toko belum dimigrasi" di `/admin`
- **Artinya** Supabase #2 belum punya kolom pembayaran manual
  (`payment_method`, `manual_*`) dan/atau kolom WhatsApp
  (`manual_payment_settings.whatsapp_number`, `whatsapp_message_template`).
  Situs sengaja tetap jalan (dashboard tampil, antrian kosong), tetapi checkout
  menolak order dengan **503** sampai migrasinya dijalankan.
- **Cek**: banner di `/admin` sudah memuat pesan error database + SQL lengkap;
  penjelasan tambahan ada di §18.
- **Solusi**: jalankan SQL dari banner (atau dua file migrasi di
  `supabase/store/`) → muat ulang `/admin`. Pemeriksaan skema diulang otomatis
  tiap ±60 detik per instance, **tanpa redeploy**.

## 16. Nomor WhatsApp di halaman pembayaran masih nomor lama
- **Penyebab**: nomor yang dipakai adalah nilai yang tersimpan saat halaman
  dirender; atau nomor diperbarui di env sementara kolom DB sudah terisi (DB
  selalu menang).
- **Cek**: `/admin/settings` → panel status menyebut sumber nomor
  (`numberFromDatabase`). Bila `true`, nomor dari form; bila `false`, dari
  `WHATSAPP_SELLER_NUMBER`.
- **Solusi**: simpan nomor yang benar di `/admin/settings` → buka ulang
  `/pay/[code]` (tombol memakai nomor terbaru; chat yang sudah terlanjur
  terbuka tidak bisa diubah). Kalau nomornya justru harus dari env, kosongkan
  kolom DB-nya dulu.

## 17. Buyer sudah konfirmasi transfer tapi order belum PAID
- Ini **normal** untuk pembayaran manual: klaim buyer hanya memindahkan order ke
  antrian verifikasi (`manual_claim_at` terisi, `payment_status` tetap PENDING).
- Cek: `/admin` → kartu **Perlu verifikasi**, atau `/admin/orders?status=CLAIM`.
- Uang ada di mutasi → **✓ Konfirmasi Lunas**; tidak ada → **✕ Tolak Klaim**
  + alasan (buyer boleh konfirmasi ulang selama belum kadaluarsa).
- Telegram tidak mengirim "🧾 KLAIM TRANSFER MANUAL"? lihat kasus 8 (token/chat
  ID) — kegagalan kirim TIDAK membatalkan klaim, antrian di dashboard tetap ada.
- Order manual yang sudah diklaim sengaja **tidak** di-expire otomatis; yang
  belum diklaim tetap kadaluarsa lewat `payment_expired_at`.
- Uang ternyata **sudah** masuk untuk order yang telanjur kadaluarsa? Buka
  detail order → **✓ Konfirmasi Pembayaran Lunas** (nominal penuh) → order
  kembali `PAID`. Tidak perlu membuat order baru.

## 18. "Application error" di `/admin` — `column orders.payment_method does not exist`

Gejala persisnya (Vercel → Logs):

```json
{"level":"error","event":"admin_order_list_failed","message":"column orders.payment_method does not exist"}
{"level":"error","event":"admin_stats_failed","message":""}
```

…dan browser menampilkan *"Application error: a server-side exception has
occurred (see the server logs for more information)"* saat membuka `/admin`.

- **Penyebab**: database Supabase #2 **belum punya kolom pembayaran manual**
  (`payment_method`, `manual_*`) padahal kode aplikasi sudah memakainya —
  `supabase/store/002_manual_payment.sql` belum dijalankan di project yang
  skemanya dibuat dari `001_schema.sql` versi lama. Error Postgres-nya
  SQLSTATE **42703**. Varian lain: kolomnya sudah ada tetapi **schema cache
  PostgREST basi** (kolom dihapus / database di-restore) → pesan yang sama.
- **Kenapa ada baris `admin_stats_failed` dengan `message` kosong?** Statistik
  dashboard memakai query `count` (`head: true`) = request **HEAD**, dan
  respons HEAD tidak punya body, jadi `error.message` dari Supabase berupa
  string kosong. Sejak perbaikan, log-nya menyertakan nama statistik +
  `code` (`{"stat":"needVerification","code":"42703", …}`).
- **Cek** (Supabase #2 → SQL Editor) — harus mengembalikan **10 baris**:
  ```sql
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'orders'
    and column_name in (
      'charged_amount','payment_method','manual_claim_at','manual_claim_note',
      'manual_claim_reference','manual_claim_notified_at','manual_reviewed_at',
      'manual_reviewed_by','manual_review_status','manual_review_note')
  order by column_name;
  ```
  Jalan pintas: buka `/admin` — bila skema belum siap, ada **banner merah**
  berisi SQL yang tinggal disalin.
- **Solusi** (tanpa deploy ulang):
  1. Supabase #2 → **SQL Editor → New query** → paste isi
     `supabase/store/002_manual_payment.sql` lalu
     `supabase/store/004_whatsapp_payment.sql` (atau SQL dari banner) → **Run**.
     Keduanya idempoten: tidak menghapus/mengubah data yang ada.
  2. Bila error masih muncul padahal kolom sudah ada, muat ulang schema cache:
     `notify pgrst, 'reload schema';` (atau Dashboard → Project Settings → API
     → *Reload schema cache*).
  3. Tunggu maksimal ±1 menit (aplikasi memeriksa ulang skema tiap 60 detik
     per instance) lalu muat ulang `/admin`.
- **Selama belum diperbaiki**, aplikasi sengaja *degrade* alih-alih mati:
  dashboard tetap tampil dengan antrian "Klaim transfer manual" kosong, kartu
  **Perlu verifikasi** 0, dan checkout menolak membuat order dengan pesan
  "Pembayaran belum tersedia" (HTTP 503) — tidak ada order menggantung. Log
  penandanya: `store_schema_outdated`, `admin_manual_queue_unavailable`,
  `admin_order_list_schema_gap`.

## 19. Migrasi 004 terlewat — nomor WhatsApp tidak bisa disimpan

- **Gejala.** Di `/admin/settings`, menyimpan nomor WhatsApp gagal; panel
  **Status saat ini** tetap `schema_missing`. Di Vercel Runtime Logs muncul
  `manual_settings_fetch_failed` dengan pesan Postgres
  `column manual_payment_settings.whatsapp_number does not exist`
  (SQLSTATE `42703`). Checkout membalas **503** "Pembayaran belum tersedia".
- **Penyebab.** Database belum menjalankan
  `supabase/store/004_whatsapp_payment.sql` (kolom nomor WA + template pesan
  ditambahkan di situ; `001_schema.sql` versi lama belum memuatnya).
- **Solusi** (satu langkah, tanpa deploy ulang):
  1. Supabase #2 → **SQL Editor → New query** → paste isi
     `supabase/store/004_whatsapp_payment.sql` (atau SQL dari banner `/admin`) →
     **Run**.
  2. Idempoten & non-destruktif: menambah kolom `whatsapp_number` +
     `whatsapp_message_template`, menjadikan `'MANUAL'` default
     `orders.payment_method`, dan merapikan label default lama — **tidak ada
     satu pun baris order yang diubah**.
  3. Simpan nomor WhatsApp lagi, muat ulang `/admin`. Pemeriksaan skema diulang
     maksimal ±1 menit (tanpa redeploy).
- **Order YoBasePay/Stenly lama tetap aman.** Nilai arsip tetap diizinkan
  constraint, jadi seluruh histori transaksi tetap valid dan tetap terbaca di
  `/admin/orders` (ditandai "QRIS Otomatis (lama)").
