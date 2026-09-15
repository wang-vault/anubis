# Integrasi YoBasePay — dari nol sampai order jadi PAID

Ditulis terhadap **dokumentasi publik resmi**: `https://yobasepay.net/index.php?page=docs_public`
(diakses **2026-09-11**). Bila dokumentasi provider sudah berubah, ikuti
dashboard akun Anda (menu Docs) dan sesuaikan HANYA file
`src/lib/integrations/payment/yobasepay.ts` — kode bisnis tidak tersentuh.

> **Update 2026-09-12.** Halaman `docs_public` sekarang **mensyaratkan login**
> ("Silakan login terlebih dahulu untuk mengakses dokumentasi teknis API"), jadi
> kontrak API tidak bisa lagi diverifikasi dari luar. Dua hal diverifikasi ulang
> tanpa login:
> 1. **Endpoint V1 masih hidup** — probe `GET https://yobasepay.net/api?action=createpayment&apikey=test&amount=10000`
>    menjawab `{"status":false,"message":"Invalid API Key"}`. Artinya base URL,
>    nama action, dan bentuk `{status,data,message}` di adapter ini benar; yang
>    ditolak adalah kredensialnya.
> 2. **Homepage mereka menampilkan `POST /api/v4/create-transaction`** sebagai
>    "Unified API Core". Adapter ini mengimplementasikan **API V1** (GET
>    `?action=createpayment`). Paket **Starter (Rp 0) hanya mengaktifkan V1**;
>    V1+V2+V3 terbuka mulai paket Rp 50.000. Bila akun Anda memakai V4/MyPG,
>    adapter perlu disesuaikan (satu file, logika bisnis tidak berubah).
>
> Karena nama field tidak lagi bisa dipastikan dari luar, **semua varian QR yang
> dikenal ditangani di `src/lib/integrations/payment/normalize.ts`** dan ada
> **tombol diagnosa** di `/admin/settings` (lihat §4b).

> **YoBasePay adalah Payment Engine (API wrapper) atas mutasi QRIS, BUKAN payment
> gateway.** Dana masuk ke Saldo YoBasePay (YC) / QRIS pribadi Anda tergantung
> paket (V1 Standard, V2 MyMerchant, V3 no-unique-code, V4 Multi-channel,
> MyPG). Tidak ada kewajiban KYC berat untuk V1; V2 butuh foto usaha+selfie.
> Konsekuensi arsitektur: **nominal yang ditagihkan = harga + kode unik**
> (+1..99 untuk <500rb, +100..999 untuk ≥500rb) supaya cocok otomatis dari
> mutasi. Aplikasi ini sudah memvalidasi rentang itu (`YOBASEPAY_AMOUNT_TOLERANCE`).

> **Integrasi ini OPSIONAL.** Toko punya metode kedua — **Transfer Manual**
> (QRIS statis milikmu, mis. QR GoPay Merchant) yang tidak butuh provider sama
> sekali: lihat `docs/manual-payment.md`. Bila akun YoBasePay belum aktif,
> kosongkan `YOBASEPAY_API_KEY` & `YOBASEPAY_WEBHOOK_SECRET` → webhook ditolak
> 403 dan order QRIS via API balas 409, sementara toko tetap berjualan lewat
> pembayaran manual. Setelah aktif, isi kembali kedua variabel itu —
> integrasinya hidup tanpa perubahan kode (webhook, cek status, order via API).
>
> **Catatan status produk:** sejak integrasi manual, opsi "QRIS Otomatis" di
> halaman `/checkout` **selalu** ditampilkan dengan badge **"Ongoing"** dan
> disabled (lihat `getCheckoutPaymentMethods()` di
> `src/lib/payment-config.ts`) — pembeli diarahkan memakai Transfer Manual.
> Mengisi credential YoBasePay TIDAK mengubah tampilan itu; yang aktif adalah
> sisi server-nya. Untuk menguji alur QRIS dari sisi buyer, buat order lewat
> `POST /api/orders` dengan `"paymentMethod": "YOBASEPAY"` (§5).

## 1. Buat akun & project

1. Buka https://yobasepay.net → **Daftar** (email) → verifikasi.
2. Login ke dashboard → buat **Project** (nama bebas, mis. `toko`).
3. Dashboard menampilkan: **API Key** (dipakai sebagai `apikey`), **Webhook
   secret** (untuk tanda tangan), dan **Domain lock** (daftarkan domain produksi).
4. Pilih paket/akses (V1 cukup mulai gratis). Isi saldo YC sesuai kebutuhan —
   saldo dipakai untuk biaya flat/fee per transaksi sesuai paket (lihat tabel
   harga di situs; bukan urusan aplikasi ini).

## 2. API yang dipakai aplikasi ini (dokumentasi publik)

Base URL: `https://yobasepay.net/api` (docs menampilkan `//api`; env
`YOBASEPAY_BASE_URL` bisa disesuaikan bila dashboard Anda memberi bentuk lain).
Semua request **wajib** menyertakan header `Origin`/`Referer` = domain terdaftar
(Domain Lock) — sudah dilakukan otomatis oleh `src/lib/integrations/payment/yobasepay.ts`.

### 2.1 Create payment
```
GET {base}?action=createpayment&apikey={API_KEY}&amount={INTEGER_RUPIAH}
→ 200 {"status":true,"data":{
     "trx_id":"YO-ABC12345",
     "amount":10123,            # total + kode unik otomatis
     "payment_url":"https://…/pay/…",
     "qr_image":"https://…",    # gambar QR untuk ditampilkan
     "expired_at":"2026-01-01 12:00:00",
     "environment":"sandbox"    # lingkungan ditentukan di dashboard, bukan per-request
}}
```
Gagal: `{"status":false,"message":"…"}` → aplikasi melambungkan
`PaymentProviderError`, order ditandai FAILED/EXPIRED, user melihat
"Gerbang pembayaran sedang tidak tersedia."

### 2.2 Check status (privat, API key)
```
GET {base}?action=checkstatus&apikey={API_KEY}&trxid={TRX_ID}
→ data.status: "SUCCESS" | "EXPIRED" | (pending value lain → dianggap PENDING)
```
Dipakai: polling halaman pembayaran (throttled 10 dtk/order) + tombol admin
"Cek Pembayaran". Ini cadangan bila webhook lambat — BUKAN satu-satunya jalur.

### 2.3 Webhook → aplikasi Anda
```
POST https://tokoanda.com/api/webhooks/yobasepay
Header: X-YoBasePay-Signature: hex(HMAC-SHA256(<raw body>, WEBHOOK_SECRET))
Body (contoh docs): { "trxid": "YO-…", "status": "SUCCESS"|"EXPIRED", "amount": 10123 }
```
Aplikasi menjawab `200 {"ok":true,"handled":"paid"}` dan menyimpan PAID.

### 2.4 Yang TIDAK ada di dokumentasi publik — tandai [VERIFIKASI]

Jangan mengarang. Kode ditulis toleran, tetapi **cek dashboard docs akunmu**:
1. Parameter `reference/order_id` di createpayment — docs publik hanya
   `apikey` + `amount`. Aplikasi ini **mencocokkan webhook via `trx_id`**
   (tersimpan di `orders.payment_id` unik), jadi tidak butuh reference. Bila
   API versi akunmu mendukung reference dan kamu menginginkannya, tambahkan.
2. Nama field QR: contoh docs `qr_image`; ada pula `qr_image_url`/`qris_url`
   di beberapa tempat. Kode menerima ketiganya.
3. Nilai status persis (apakah pending = `"PENDING"`/`"WAITING_PAYMENT"`);
   mapper `mapStatus()` menerima varian umum — tambahkan case bila docs
   akunmu memakai kata lain.
4. Format `expired_at` dan zona waktu — diasumsikan **WIB** (env
   `YOBASEPAY_EXPIRY_TZ_OFFSET`); sesuaikan bila terbukti lain.
5. Apakah webhook body memakai `trxid` atau `trx_id` — keduanya diterima.

### 2.5 Bentuk data QR yang ditoleransi aplikasi

Ini bagian yang paling sering membuat "QR gagal" padahal transaksinya **berhasil
dibuat**: provider mengirim QR dalam bentuk yang tidak langsung bisa dipakai
atribut `src` sebuah `<img>`. `normalize.ts` menangani semuanya:

| Bentuk nilai dari provider | Contoh | Perlakuan |
|---|---|---|
| URL https absolut | `https://yobasepay.net/qr/a.png` | dipakai apa adanya |
| URL http | `http://yobasepay.net/qr/a.png` | dinaikkan ke https (menghindari *mixed content*) |
| Protocol-relative | `//yobasepay.net/qr/a.png` | diberi skema `https:` |
| Path relatif | `/uploads/qr/a.png`, `qr/ABC123` | di-resolve terhadap origin `YOBASEPAY_BASE_URL` |
| `data:` URI gambar | `data:image/png;base64,iVBOR…` | dipakai apa adanya |
| Base64 tanpa prefix | `iVBORw0KGgo…` | dibungkus jadi `data:image/png;base64,…` |
| **Payload QRIS (EMVCo)** | `0002010102122668…` | **tidak bisa dirender sendiri** → lihat bawah |
| Skema lain | `javascript:…` | ditolak (guard `src/lib/qr-image.ts`) |

Nama field yang dicoba (urut prioritas): `qr_image`, `qr_image_url`, `qris_url`,
`qr_url`, `qris_image`, `qris_image_url`, `qr_code_url`, `qr_code_image`,
`qrcode_url`, `qr_img`, `image_url`, `qr_image_base64`, `qr_base64`, `qr`,
`qr_code`, `qrcode`, `qris` — lalu field payload: `qr_string`, `qris_string`,
`qr_payload`, `qris_payload`, `qr_content`, `qris_content`, `qr_data`,
`qris_data`, `qr_text`, `qr_value`, `qr_raw`, `brcode`, `br_code`, `payload`.
Hal yang sama berlaku untuk `trx_id`/`payment_url`/`amount`/`expired_at`
(daftar lengkap: konstanta `*_KEYS` di `normalize.ts`).

**Bila provider hanya mengirim PAYLOAD QRIS** (string EMVCo, bukan gambar),
aplikasi tidak bisa menggambar QR sendiri tanpa encoder. Dua pilihan:

1. Isi `YOBASEPAY_QR_RENDER_URL` dengan template https yang memuat `{payload}`,
   mis. `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data={payload}`.
   Payload di-URL-encode otomatis. Catatan privasi: payload memuat nama merchant
   & nominal, jadi lebih baik host renderer sendiri bila tidak ingin mengirimnya
   ke pihak ketiga.
2. Biarkan kosong → buyer memakai tombol **"Buka Halaman Pembayaran"**
   (`payment_url` dari provider). Transaksi tetap bisa dibayar.

Saat ini terjadi, log mencetak `yobasepay_qr_payload_only`; bila QR tidak ada
sama sekali, log mencetak `yobasepay_qr_missing`. **Keduanya menyertakan daftar
nama field yang dikirim provider** — itulah informasi yang dibutuhkan untuk
menambah field baru ke `normalize.ts`.

## 4b. Diagnosa dari dashboard admin (tanpa curl, tanpa buka log)

`/admin/settings` → bagian **"Diagnosa QRIS Otomatis"** → tombol **Jalankan
diagnosa** (endpoint `GET /api/admin/payments/diagnose`, khusus admin).

Yang dilakukan: memanggil `checkstatus` dengan **trxid karangan** → **tidak
membuat transaksi dan tidak memotong saldo**, tetapi cukup untuk mengetahui
apakah kredensial diterima. Jawaban provider diterjemahkan menjadi vonis:

| Vonis | Arti | Yang harus dikerjakan |
|---|---|---|
| `OK_KEY_VALID` | API key + Domain Lock benar | Masalah ada di bentuk data QR → lihat §2.5 dan log `yobasepay_qr_*` |
| `NOT_CONFIGURED` | env kosong | Isi `YOBASEPAY_API_KEY` **dan** `YOBASEPAY_WEBHOOK_SECRET` → Redeploy |
| `INVALID_API_KEY` | key ditolak | Salin ulang key project **V1**; pastikan tanpa spasi → Redeploy |
| `DOMAIN_LOCK` | Origin/Referer ditolak | Samakan Domain Lock di dashboard dengan `NEXT_PUBLIC_SITE_URL` |
| `INSUFFICIENT_BALANCE` | saldo YC kurang | Top up YC (flat fee per transaksi dipotong dari saldo) |
| `PLAN_MISMATCH` | paket/API tidak mengizinkan | Cek paket aktif; Starter = V1 saja |
| `PROVIDER_UNREACHABLE` | timeout/DNS | Cek status layanan provider & `YOBASEPAY_BASE_URL` |
| `BAD_RESPONSE` | balasan bukan JSON | `YOBASEPAY_BASE_URL` mengarah ke halaman HTML, bukan endpoint API |

Panel ini juga menampilkan: nilai env **tersamar** (bukan rahasia utuh), Domain
Lock yang harus didaftarkan, Webhook URL yang harus diisi, dan base URL yang
dipakai. Batas: 10 kali / 10 menit per admin.

## 3. Pasang credential di Vercel

```
YOBASEPAY_API_KEY=…            # server-only, secret
YOBASEPAY_WEBHOOK_SECRET=…     # server-only, secret — WAJIB walau webhook belum dipakai
YOBASEPAY_BASE_URL=https://yobasepay.net/api
YOBASEPAY_AMOUNT_TOLERANCE=999 # 0 bila pakai V3 no-unique-code
YOBASEPAY_EXPIRY_TZ_OFFSET=+07:00
YOBASEPAY_QR_RENDER_URL=       # isi HANYA bila provider mengirim payload QRIS (§2.5)
```
→ Settings → Environment Variables → Save → **Redeploy**.

Tiga hal yang paling sering terlewat:

1. **Kedua secret wajib terisi.** `yobasepayConfigured()` menuntut API key **dan**
   webhook secret; bila salah satu kosong, metode QRIS **tidak tersedia** —
   `createPayment` ditolak dengan `provider_disabled` dan `POST /api/orders`
   `paymentMethod=YOBASEPAY` balas 409 ("status ongoing"). Di UI checkout opsi
   ini memang selalu tampil disabled ber-badge "Ongoing".
2. **`NEXT_PUBLIC_SITE_URL` = Domain Lock.** Nilai itu yang dikirim sebagai
   header `Origin`/`Referer` ke provider (`yobasepay.ts`). Masih
   `http://localhost:3000` padahal sudah produksi → createpayment ditolak.
3. **Saldo YC harus cukup.** Paket Starter memotong flat fee per transaksi
   (YC 500) di luar fee persentase. Saldo 0 → createpayment gagal.
   Uji dengan nominal Rp10.000–50.000, jangan Rp1.000.

## 4. Tentukan webhook URL + secret

1. Dashboard YoBasePay → Webhook/Callback → isi:
   `https://tokoanda.com/api/webhooks/yobasepay`
2. Copy secret yang disediakan (atau yang Anda tentukan) → masukkan ke Vercel
   `YOBASEPAY_WEBHOOK_SECRET` → Redeploy.
3. Daftarkan Domain Lock = domain produksi (persis dengan
   `NEXT_PUBLIC_SITE_URL` tanpa trailing slash).

## 5. Test payment end-to-end

> Karena opsi QRIS di halaman checkout saat ini tampil **"Ongoing"
> (disabled)**, order QRIS dibuat lewat API dengan cookie session buyer uji —
> bukan lewat form checkout:
>
> ```bash
> curl -sS -X POST "https://tokoanda.com/api/orders" \
>   -b "sb-<ref1>-auth-token=…" -H 'Content-Type: application/json' \
>   -d '{"productId":"<uuid>","quantity":1,"paymentMethod":"YOBASEPAY"}'
> # → 201 { order: {order_code…}, payment: { paymentUrl, qrImageUrl, expiresAt } }
> ```
> (Alternatif pengembangan: buka sementara opsi itu di
> `getCheckoutPaymentMethods()` — satu fungsi, tanpa menyentuh logika bisnis.)

1. `/admin/products` → buat produk `Rp10.000` → aktif.
2. Daftar buyer uji (email terverifikasi) → buat order QRIS (curl di atas) →
   buka `/pay/<order_code>` → muncul halaman QRIS.
3. Scan & bayar QRIS dari e-wallet manapun (nominal = 10.000 + kode unik yang
   tercetak di QR — jangan ketik manual berbeda).
4. Dalam hitungan detik: halaman buyer berubah **✅ PEMBAYARAN BERHASIL**,
   order di DB jadi PAID, penjual terima Telegram.
5. Uji expiry: buat order lain, jangan bayar sampai `expired_at` lewat →
   tombol "Cek Status"/tunggu polling → ❌ PEMBAYARAN KADALUARSA.

## 6. Test webhook — tanpa membayar (curl bertanda tangan)

Dari laptop (Linux/macOS/WSL):
```bash
SECRET="isi_YOBASEPAY_WEBHOOK_SECRET_anda"
DOMAIN="https://tokoanda.com"
BODY="{\"trxid\":\"YO-CEK-DARI-DB\",\"status\":\"SUCCESS\",\"amount\":10123}"
SIG=$(node -e "console.log(require('crypto').createHmac('sha256',process.argv[2]).update(process.argv[1],'utf8').digest('hex'))" "$BODY" "$SECRET")
curl -sS -X POST "$DOMAIN/api/webhooks/yobasepay" \
  -H 'Content-Type: application/json' \
  -H "X-YoBasePay-Signature: $SIG" \
  -d "$BODY"
# {"ok":true,"handled":"paid"}  ← order menjadi PAID + notifikasi terkirim
```
`trxid` diambil dari Supabase #2 → Table Editor → order → kolom `payment_id`.

**Test penolakan:** ubah 1 karakter signature → harus `403 INVALID_SIGNATURE`;
`amount` salah → `{"handled":"ignored","reason":"amount_mismatch"}` (order
TIDAK berubah, error dicatat di log).

## 7. Memastikan signature + nominal + idempotensi bekerja

- Signature: dihitung atas **raw body** (tepat seperti dikirim), dibanding
  constant-time (`crypto.timingSafeEqual`) di
  `verifyWebhookSignature()`. Jangan pernah parse→stringify→verifikasi.
- Nominal: `total ≤ amount ≤ total + YOBASEPAY_AMOUNT_TOLERANCE`
  (`validateWebhookAmount`). Amount hilang/salah → webhook diabaikan.
- Idempoten: update PAID bersyarat `WHERE payment_status IN ('PENDING','EXPIRED')`;
  kirim ulang webhook yang sama → `{handled:"paid",reason:"already_processed"}`,
  order tidak berubah dua kali, Telegram tidak dobel (klaim `telegram_notified_at`).
- Log: cari `webhook_received` / `order_paid` di Vercel → Runtime Logs.

## 8. Bila API provider berubah / tidak cocok

1. Jangan mengubah logika bisnis — ubah hanya adapter `yobasepay.ts`
   (endpoint, field, nama header) sesuai docs dashboard akunmu.
2. Bila provider menghapus webhook atau field: fallback sudah ada
   (`/api/payments/status` → checkstatus privat; tombol admin).
3. Provider lain (mis. Midtrans) = implementasi interface `PaymentProvider`
   baru — lihat `docs/architecture.md` §7. **Jangan aktifkan mode mock/sandbox
   palsu di kode produksi.**
