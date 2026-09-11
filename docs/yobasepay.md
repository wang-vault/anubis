# Integrasi YoBasePay — dari nol sampai order jadi PAID

Ditulis terhadap **dokumentasi publik resmi**: `https://yobasepay.net/index.php?page=docs_public`
(diakses **2026-09-11**). Bila dokumentasi provider sudah berubah, ikuti
dashboard akun Anda (menu Docs) dan sesuaikan HANYA file
`src/lib/integrations/payment/yobasepay.ts` — kode bisnis tidak tersentuh.

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
> kosongkan `YOBASEPAY_API_KEY` & `YOBASEPAY_WEBHOOK_SECRET` → metode QRIS
> otomatis disembunyikan dari checkout dan webhook ditolak 403, sementara toko
> tetap berjualan lewat pembayaran manual. Setelah aktif, isi kembali kedua
> variabel itu — metodenya muncul lagi tanpa perubahan kode.

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

## 3. Pasang credential di Vercel

```
YOBASEPAY_API_KEY=…            # server-only, secret
YOBASEPAY_WEBHOOK_SECRET=…     # server-only, secret
YOBASEPAY_BASE_URL=https://yobasepay.net/api
YOBASEPAY_AMOUNT_TOLERANCE=999 # 0 bila pakai V3 no-unique-code
```
→ Settings → Environment Variables → Save → **Redeploy**.

## 4. Tentukan webhook URL + secret

1. Dashboard YoBasePay → Webhook/Callback → isi:
   `https://tokoanda.com/api/webhooks/yobasepay`
2. Copy secret yang disediakan (atau yang Anda tentukan) → masukkan ke Vercel
   `YOBASEPAY_WEBHOOK_SECRET` → Redeploy.
3. Daftarkan Domain Lock = domain produksi (persis dengan
   `NEXT_PUBLIC_SITE_URL` tanpa trailing slash).

## 5. Test payment end-to-end

1. `/admin/products` → buat produk `Rp10.000` → aktif.
2. Daftar buyer uji (email terverifikasi) → checkout → muncul halaman QRIS.
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
