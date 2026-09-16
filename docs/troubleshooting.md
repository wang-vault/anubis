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

## 4. "QRIS tidak muncul / halaman pembayaran kosong"

**Langkah pertama: `/admin/settings` → "Diagnosa QRIS Otomatis" → Jalankan
diagnosa.** Tombol ini menguji kredensial ke provider tanpa membuat transaksi
(`yobasepay.md` §4b) dan langsung menyebut penyebabnya: API key salah, Domain
Lock menolak, saldo YC kurang, paket tidak mengaktifkan V1, atau provider tak
terjangkau.

Lalu bedakan dua kasus lewat Supabase #2 → `orders` (baris order tes):

**4a. `payment_id` NULL, `payment_status=FAILED`** → transaksi gagal DIBUAT.
- Penyebab: key salah/kosong, Domain Lock ≠ `NEXT_PUBLIC_SITE_URL`, saldo YC 0,
  paket tidak mengaktifkan API V1, provider down, base URL salah.
- Cek: log `payment_create_failed` (field `detail` = pesan asli provider);
  buyer melihat "Gerbang pembayaran sedang tidak tersedia."
- Solusi: ikuti vonis panel diagnosa → perbaiki env/dashboard → **Redeploy**
  bila yang diubah env. Order gagal → buyer order ulang.

**4b. `payment_id` TERISI (`YO-…`) tapi QR tak tampil** → transaksi berhasil,
gambarnya yang tidak bisa dirender. Halaman bayar menampilkan "QR tidak
tersedia — gunakan tombol Buka Halaman Pembayaran".
- Penyebab: provider mengirim QR dalam bentuk yang tak terduga — payload QRIS
  (string EMVCo) alih-alih gambar, base64, atau nama field di luar daftar.
- Cek: log `yobasepay_qr_payload_only` atau `yobasepay_qr_missing` — keduanya
  mencetak **daftar nama field** yang dikirim provider. Kolom `qr_image_url`
  di DB: null / bukan https / `data:` URI.
- Solusi: payload QRIS → isi `YOBASEPAY_QR_RENDER_URL` (`yobasepay.md` §2.5);
  nama field baru → tambahkan ke konstanta `QR_IMAGE_KEYS`/`QR_PAYLOAD_KEYS` di
  `src/lib/integrations/payment/normalize.ts` (modul murni, ada unit test);
  sementara itu buyer tetap bisa bayar lewat tombol "Buka Halaman Pembayaran".

## 5. "Pembayaran sudah dilakukan tapi order masih PENDING"
- Penyebab umum: webhook telat/belum dikonfigurasi; nominal tidak cocok
  (buyer mengetik sendiri jumlah tanpa kode unik!); order lookup gagal karena
  `payment_id` tak tersimpan; DB error saat proses webhook.
- Cek (berurutan):
  1. Supabase #2 → orders baris tsb: `payment_id` terisi? status? `last_payment_checked_at`?
  2. Vercel logs: `webhook_received` ada? → `webhook_amount_invalid` / `order_not_found`?
  3. Dashboard YoBasePay: transaksi SUCCESS di sisi mereka?
- Solusi cepat untuk penjual: tombol **⟳ Cek Pembayaran** (pakai API privat —
  tidak butuh webhook) → harusnya jadi PAID. Bila webhook mati total: cocokkan
  manual + perbaiki webhook URL/secret; jangan tandai PAID dari DB manual kecuali
  keadaan darurat (tidak ada notifikasi). Edukasi buyer: scan QR saja, jangan
  ketik nominal.

## 6. "Webhook tidak masuk" (log tidak mencatat sama sekali)
- Penyebab: URL webhook salah/berubah setelah pindah domain; provider menahan
  kirim (URL tidak terjangkau — port/firewall?); Vercel Deployment Protection
  memblokir bot (HTTP 401 dari `vercel` header!).
- Cek: curl dari internet → `curl -X POST https://domain/api/webhooks/yobasepay -d '{}'`
  harus **400/403** (sampai app), bukan 401/405. Di Vercel: Settings →
  **Deployment Protection** → matikan untuk Production ATAU (lebih aman) aktifkan
  "Vercel Authentication" *only for Preview*.
- Solusi: daftarkan ulang URL final di YoBasePay; pastikan pakai https domain
  produksi; kirim test lagi.

## 7. "Webhook signature invalid" (403 tercatat di log)
- Penyebab: `YOBASEPAY_WEBHOOK_SECRET` tidak sama dengan di dashboard (sering
  lupa redeploy setelah ganti!); provider mengirim header berbeda nama;
  proxy mengubah body (mis. re-write JSON).
- Cek: log `webhook_signature_invalid`; env value di Vercel vs dashboard YoBasePay;
  `curl` test signature dari laptop (yobasepay.md §6) → kalau curl lolos berarti
  masalah di sisi kirim provider/proxy.
- Solusi: samakan secret → Redeploy; verifikasi provider mengirim HMAC ke
  raw body — bila provider memakai format lain (mis. `sha256=hex…`) parser kita
  sudah menerima prefix itu; header custom lain → sesuaikan nama di
  `route.ts` satu baris.

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
  masuk repo: **rotasi semua key**, ganti webhook secret, tambah admin baru,
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
- Order `PENDING` permanen: expiry hanya jalan saat dicek (halaman bayar/
  tombol admin) — tidak ada cron; tekan Cek Pembayaran untuk membersihkan,
  atau biarkan (tidak mengganggu apa pun).

## 14. Data Supabase penuh kuota / rest rate limit
- Cek: Settings → Infrastructure usage. Solusi: upgrade paket, aktifkan
  `unstable_cache` (sudah on), pertimbangkan read replica — di luar MVP.

## 15. Metode "Transfer Manual" tidak bisa dipilih di checkout
- Gejalanya: opsi tampil TETAPI greyed/disabled (atau checkout menolak dengan
  "Pembayaran belum tersedia"). Penyebab: gambar QR belum diunggah, saklar
  di `/admin/settings` mati, atau `MANUAL_PAYMENT_ENABLED=false`.
- Cek: `/admin/settings` → bagian **Status saat ini** menjelaskan alasan persisnya
  (`no_qr` = belum ada gambar, `disabled` = saklar mati).
- Solusi: unggah gambar QR (PNG/JPG/WebP ≤ 900 KB) → Simpan → buka `/checkout`
  lagi. Tidak perlu deploy ulang.
- Bila `MANUAL_PAYMENT_QR_IMAGE_URL` diisi, URL itu yang dipakai — pastikan
  https dan bisa dibuka di tab privat.

## 15b. "QRIS Otomatis" tidak bisa diklik / badge "Ongoing"
- **Artinya kredensialnya belum terbaca server.** Opsi QRIS Otomatis di
  checkout hanya bisa dipilih bila `YOBASEPAY_API_KEY` **dan**
  `YOBASEPAY_WEBHOOK_SECRET` terisi di environment (Vercel) dan sudah
  **diredeploy**. Salah satu kosong → opsi tampil `disabled` + badge
  **"Ongoing"** ("sedang dalam proses") supaya buyer tahu metode itu belum
  dibuka dan memakai Transfer Manual.
- Cek cepat: `/admin/settings` → panel **Status saat ini** → baris "QRIS
  Otomatis (YoBasePay)". Tertulis *dapat dipilih pembeli di halaman checkout*
  = sudah aktif; *ONGOING (sedang disiapkan)* = env belum terbaca (nilai
  kosong, salah project/environment Vercel, atau belum redeploy setelah
  disimpan).
- Saat env belum terisi, sisi server-nya ikut mati: webhook ditolak 403 dan
  `POST /api/orders {"paymentMethod":"YOBASEPAY"}` balas 409 ("status
  ongoing"). Setelah env terisi + redeploy, semuanya hidup bersamaan: webhook,
  `⟳ Cek Pembayaran` admin, order via API, dan pilihan di UI checkout.

## 16. Gambar QR buyer rusak / tidak tampil
- Cek langsung: buka `https://tokoanda.com/api/manual-qr` di tab baru.
  404 = belum ada gambar di DB; gambar pecah = file asli rusak/format aneh.
- Solusi: unggah ulang PNG hasil unduhan aplikasi merchant (hindari hasil
  screenshot yang sudah dikompres berat); bila memakai URL eksternal, pastikan
  server gambarnya tidak memblokir hotlink.

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
- **Solusi** (satu langkah, tanpa deploy ulang):
  1. Supabase #2 → **SQL Editor → New query** → paste isi
     `supabase/store/002_manual_payment.sql` (atau SQL dari banner) → **Run**.
     Idempoten: tidak menghapus/mengubah data yang ada.
  2. Bila error masih muncul padahal kolom sudah ada, muat ulang schema cache:
     `notify pgrst, 'reload schema';` (atau Dashboard → Project Settings → API
     → *Reload schema cache*).
  3. Tunggu maksimal ±1 menit (aplikasi memeriksa ulang skema tiap 60 detik
     per instance) lalu muat ulang `/admin`.
- **Selama belum diperbaiki**, aplikasi sengaja *degrade* alih-alih mati:
  dashboard tetap tampil dengan antrian "Klaim transfer manual" kosong, kartu
  **Perlu verifikasi** 0, checkout menolak Transfer Manual dengan pesan
  "Pembayaran manual sedang tidak tersedia" (HTTP 503), dan order QRIS
  Otomatis tetap bisa dibuat (kolom `payment_method` tidak dikirim saat
  insert). Log penandanya: `store_schema_outdated`,
  `admin_manual_queue_unavailable`, `admin_order_list_schema_gap`.
