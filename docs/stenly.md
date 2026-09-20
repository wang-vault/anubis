# Integrasi Stenly (StenlyPay) — dari nol sampai order jadi PAID

Ditulis terhadap **dokumentasi resmi** <https://stenly.id/docs> (diakses
**2026-09-20**). Bila dokumentasi provider berubah, sesuaikan **hanya**
`src/lib/integrations/payment/stenly.ts` + `normalize.ts` — logika bisnis
(`src/lib/orders.ts`) tidak boleh tersentuh.

> **Stenly menggantikan YoBasePay.** Provider lama sudah dihapus dari kode.
> Order lama tetap tersimpan apa adanya (`payment_method = 'YOBASEPAY'`) dan
> tetap bisa dibaca dashboard — lihat §10.

> **Integrasi ini OPSIONAL.** Toko punya metode kedua, **Transfer Manual**
> (QRIS statis milikmu, mis. QR GoPay Merchant), yang tidak butuh provider sama
> sekali: lihat `docs/manual-payment.md`. Selama `STENLY_API_KEY` atau
> `STENLY_WEBHOOK_SECRET` kosong, opsi "QRIS Otomatis" tampil ber-badge
> **"Ongoing"** (disabled) dan webhook ditolak — toko tetap berjualan.

---

## 1. Buat akun, project, dan API key

1. Buka <https://stenly.id> → **Daftar** → verifikasi email → login.
2. Dashboard → **Projects** → **New Project** (nama bebas, mis. `toko`).
3. Buka detail project. Di sana tersedia:

   | Kredensial | Bentuk | Dipakai untuk |
   | --- | --- | --- |
   | **Secret Key** | `sk_live_…` (produksi) / `sk_test_…` (sandbox) | header `x-api-key` saat create charge & cek status |
   | **Public Key** | `pk_live_…` / `pk_test_…` | lookup read-only dari frontend — **tidak dipakai aplikasi ini** |
   | **Webhook Secret** | `whsec_…` | verifikasi HMAC-SHA256 pada webhook |
   | **Callback URL** | kamu isi sendiri | alamat webhook aplikasi (§4) |

4. **IP Whitelist (opsional).** Bila kamu mengaktifkannya di project, endpoint
   `charge`/`cancel`/`simulate-pay` hanya menerima IP yang terdaftar dan
   membalas **403** berisi IP yang terdeteksi. Vercel **tidak** memberi IP
   keluar yang tetap pada paket umum, jadi **biarkan whitelist kosong** kecuali
   kamu memakai static egress IP. Endpoint `status` tidak kena pembatasan ini.

**Jangan pernah** menaruh Secret Key atau Webhook Secret di variabel berawalan
`NEXT_PUBLIC_` — keduanya server-only.

---

## 2. API yang dipakai aplikasi ini

Semua kontrak di bawah disalin dari dokumentasi resmi. Base URL default
`https://stenly.id` (`STENLY_BASE_URL`).

### 2.1 Create charge — `POST {BASE}/api/v1/charge`

```
Headers: Content-Type: application/json
         x-api-key: sk_live_…
Body:    { "order_id": "ORD-20260920-AB12CD",   // wajib, unik, maks 100 karakter
           "gross_amount": 50000,                // wajib, IDR, minimum 1000
           "customer_name":  "Budi",             // opsional
           "customer_email": "budi@example.com", // opsional
           "customer_phone": "6281234567890",    // opsional
           "expiry_minutes": 15 }                // opsional, default 15
```

Respons **201**:

```json
{
  "status": "success",
  "data": {
    "order_id": "ORD-20260920-AB12CD",
    "project_slug": "toko",
    "gross_amount": 50000,
    "currency": "IDR",
    "status": "pending",
    "payment_method": "qris",
    "qr_string": "00020101021226670016ID.STENLY.WWW…",
    "qr_image_url": "/api/v1/qr/ORD-…?api_key=sk_live_…",
    "payment_url": "https://stenly.id/pay/ORD-…",
    "expires_at": "2026-09-20T07:20:00.000Z",
    "created_at": "2026-09-20T07:05:00.000Z"
  }
}
```

Catatan penting:

* **Idempoten:** memanggil ulang dengan `order_id` + nominal yang sama
  mengembalikan transaksi yang sudah ada. Nominal berbeda → **409**.
* **Batas nominal QRIS:** Rp1.000 s.d. Rp10.000.000. Aplikasi memeriksa batas
  ini sebelum memanggil API (`STENLY_MIN_AMOUNT` / `STENLY_MAX_AMOUNT`).
* **`expires_at` adalah ISO-8601 UTC** (akhiran `Z`) — tidak perlu env offset
  zona waktu.

### 2.2 Cek status — `GET {BASE}/api/v1/status/:order_id`

Header `x-api-key`. Status yang didokumentasikan:

| Status Stenly | Arti | Status internal |
| --- | --- | --- |
| `pending` | belum dibayar | `pending` |
| `paid` | lunas | `paid` |
| `paid_after_expiry` | dibayar sebelum kedaluwarsa, terdeteksi telat (≤24 jam, toleransi 5 menit) | `paid` |
| `expired` | QR kedaluwarsa | `expired` |
| `cancelled` | dibatalkan | `failed` |
| `sandbox_trx_pending/paid/expired/cancelled` | padanan sandbox | sama dengan versi produksi |

Status di luar daftar itu dipetakan ke `unknown` dan **tidak pernah** membuat
order jadi PAID. Pemetaan ada di `mapStenlyStatus()`
(`src/lib/integrations/payment/normalize.ts`) dan dikunci
`test/payment-normalize.test.ts`.

### 2.3 Webhook → aplikasi kamu

Stenly POST ke Callback URL project setiap status berubah:

```
POST /api/webhooks/stenly
X-Stenly-Signature : hex HMAC-SHA256 dari RAW body, kunci = whsec_…
X-Stenly-Timestamp : unix epoch dalam MILIDETIK
X-Stenly-Event     : payment.status_updated

{ "event": "payment.status_updated",
  "data": { "order_id": "ORD-…", "project_slug": "toko", "gross_amount": 50000,
            "currency": "IDR", "payment_method": "qris", "status": "paid",
            "paid_at": "2026-09-20T07:10:00.000Z", "journal_id": "…" },
  "timestamp": 1788868200000 }
```

Untuk status `expired`, payload membawa `expires_at` dan **tanpa** `paid_at` /
`journal_id`. Payload sandbox membawa `"environment": "sandbox"`.

**Kontrak balasan merchant:** HTTP 200 berisi `{"received": true}` dalam <10
detik, kalau tidak delivery ditandai `failed` dan diretry otomatis 6× (1 menit,
5 menit, 30 menit, 2 jam, 6 jam) — resend manual juga tersedia di dashboard.
Route aplikasi sudah mematuhi ini.

### 2.4 Endpoint yang **tidak** dipakai aplikasi

`POST /api/v1/cancel` (batalkan transaksi pending) dan
`POST /api/v1/simulate-pay` (sandbox, §7) ada di dokumentasi tetapi tidak
dipanggil dari kode. Keduanya bisa kamu pakai manual lewat `curl`.

---

## 3. Variabel environment

| Variabel | Wajib | Contoh | Keterangan |
| --- | --- | --- | --- |
| `STENLY_API_KEY` | untuk QRIS otomatis | `sk_live_…` | **RAHASIA**, server-only. Header `x-api-key`. |
| `STENLY_WEBHOOK_SECRET` | untuk QRIS otomatis | `whsec_…` | **RAHASIA**, server-only. Verifikasi HMAC webhook. |
| `STENLY_BASE_URL` | tidak | `https://stenly.id` | Base URL REST API, tanpa trailing slash. |
| `STENLY_EXPIRY_MINUTES` | tidak | `15` | Dikirim sebagai `expiry_minutes` (1–1440). |
| `DEFAULT_PAYMENT_METHOD` | tidak | `STENLY` \| `MANUAL` | Metode terpilih default di checkout. Nilai lama `YOBASEPAY` tetap diterima dan dibaca sebagai `STENLY`. |

**QRIS Otomatis aktif hanya jika `STENLY_API_KEY` DAN `STENLY_WEBHOOK_SECRET`
sama-sama terisi** (`stenlyConfigured()` di `src/lib/env.ts`). Salah satu kosong
→ opsi checkout ber-badge "Ongoing" dan webhook ditolak.

### Variabel yang **tidak ada** — jangan ditambahkan

* `STENLY_WEBHOOK_URL` — URL callback dihitung dari `NEXT_PUBLIC_SITE_URL` +
  `/api/webhooks/stenly` dan ditampilkan siap-salin di `/admin/settings`.
* `STENLY_AMOUNT_TOLERANCE` — QRIS Stenly menagih nominal **persis**, jadi
  toleransinya 0 (konstanta di kode). Kode unik hanya dipakai metode manual.
* `STENLY_QR_RENDER_URL` — QR dirender lokal (§5), tidak ada layanan pihak ketiga.
* `NEXT_PUBLIC_STENLY_*` — **dilarang**: semua kredensial Stenly server-only.

---

## 4. Pasang kredensial + Callback URL

### 4.1 Lokal (`.env.local`)

```dotenv
STENLY_API_KEY=sk_test_xxxxxxxxxxxx
STENLY_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx
STENLY_BASE_URL=https://stenly.id
STENLY_EXPIRY_MINUTES=15
DEFAULT_PAYMENT_METHOD=STENLY
```

Webhook tidak bisa mencapai `localhost`. Untuk uji lokal pakai tunnel
(`cloudflared tunnel --url http://localhost:3000`) lalu daftarkan URL tunnel
sebagai Callback URL, atau andalkan polling status (§6).

### 4.2 Vercel (produksi)

1. Vercel → project → **Settings → Environment Variables**.
2. Tambahkan `STENLY_API_KEY` dan `STENLY_WEBHOOK_SECRET` untuk environment
   **Production** (dan Preview bila perlu, pakai `sk_test_`). Biarkan
   "Sensitive"/encrypted aktif.
3. `STENLY_BASE_URL` & `STENLY_EXPIRY_MINUTES` hanya perlu bila ingin menimpa default.
4. **Redeploy.** Perubahan env tidak berlaku pada deployment yang sedang jalan.

### 4.3 Daftarkan Callback URL di Stenly

Dashboard Stenly → detail project → **Callback URL**:

```
https://DOMAIN-KAMU/api/webhooks/stenly
```

Salin persis URL yang ditampilkan di **/admin/settings** (panel diagnosa
menghitungnya dari `NEXT_PUBLIC_SITE_URL`). Kalau `NEXT_PUBLIC_SITE_URL` salah,
URL yang kamu daftarkan juga salah.

> **Vercel Deployment Protection harus MATI untuk Production.** Kalau aktif,
> Stenly menerima halaman login SSO (401/403) dan webhook tidak pernah sampai.

---

## 5. Alur pembayaran di aplikasi ini

```
Buyer /checkout (pilih "QRIS Otomatis")
  └─► POST /api/orders  →  createOrderForBuyer()   [src/lib/orders.ts]
        1. harga diambil dari DATABASE (input harga dari browser diabaikan)
        2. insert order: payment_method='STENLY', payment_status='PENDING'
        3. provider.createPayment({ amount, orderCode, customer… })
             └─ POST https://stenly.id/api/v1/charge
        4. simpan: payment_id (= order_id = order_code), payment_url,
                   qr_image_url (data URI hasil render lokal),
                   payment_expired_at, charged_amount
  └─► Buyer diarahkan ke /pay/<order_code> → scan QR

Stenly  ──POST──►  /api/webhooks/stenly        ← SUMBER KEBENARAN UTAMA
  1. baca RAW body (belum di-parse)
  2. verifikasi HMAC constant-time → gagal: 403 INVALID_SIGNATURE
  3. parse + normalisasi (data.order_id / data.status / data.gross_amount)
  4. cari order via payment_id, fallback order_code
  5. validasi nominal (toleransi 0) → beda: diabaikan, TIDAK PAID
  6. update status idempotent (webhook dobel = no-op)
  7. Telegram sekali per order (gagal kirim TIDAK membatalkan PAID)
  8. balas 200 {"received": true}

PaymentPanel (browser) ──tiap 8 detik──► /api/payments/status   ← CADANGAN
  └─ refreshOrderStatus(): maks 1 panggilan provider / 10 detik per order
```

**Identitas transaksi.** Stenly tidak mengembalikan ID transaksi terpisah —
kunci transaksi adalah `order_id` yang kita kirim. Karena itu
`orders.payment_id` = `orders.order_code`. Pencarian order di webhook tetap
cocok lewat keduanya.

**Gambar QR — kenapa dirender lokal.** `qr_image_url` dari Stenly menyertakan
`?api_key=sk_live_…`. Menaruhnya di `<img src>` berarti membocorkan secret key ke
browser. Karena itu aplikasi:

1. mengambil `qr_string` (payload EMVCo) dari respons charge,
2. merendernya menjadi **PNG data-URI di server** dengan paket `qrcode`
   (`src/lib/integrations/payment/qr-render.ts`) — payload tidak pernah dikirim
   ke layanan QR pihak ketiga,
3. menyimpan data-URI itu ke `orders.qr_image_url`.

`payment_url` ikut disaring (`sanitizeProviderUrl()`): kalau provider
menyertakan parameter berisi kunci, parameternya dibuang dan dicatat
`stenly_payment_url_secret_stripped` di log. String QR produksi **tidak pernah
dimodifikasi**, sesuai anjuran dokumentasi.

---

## 6. Webhook vs polling

* **Webhook = sumber kebenaran utama.** Status berubah begitu Stenly mengirim
  notifikasi bertanda tangan sah.
* **Polling = cadangan.** `/api/payments/status` (maks 30 permintaan/menit per
  user) memanggil `GET /api/v1/status/:order_id`, dengan throttle **1×/10 detik
  per order** dan masa tenggang 30 detik setelah expiry. Ini menutupi webhook
  yang telat/gagal, dan tetap hemat kuota provider.

Keduanya memakai validasi nominal & transisi status yang sama, jadi tidak ada
jalur yang bisa membuat order PAID tanpa nominal yang cocok.

---

## 7. Uji coba: sandbox, end-to-end, dan webhook

### 7.1 Sandbox

Pakai project dengan key `sk_test_…`. QR sandbox **tidak bisa** dibayar sungguhan;
simulasikan pembayarannya:

```bash
curl -X POST https://stenly.id/api/v1/simulate-pay \
  -H "x-api-key: sk_test_xxx" -H "Content-Type: application/json" \
  -d '{"order_id":"ORD-20260920-AB12CD"}'
```

Status menjadi `sandbox_trx_paid` dan webhook dikirim. Panel diagnosa di
`/admin/settings` menandai mode sandbox secara eksplisit.

### 7.2 End-to-end (produksi, nominal kecil)

1. Buat produk murah (mis. Rp1.000 — minimum Stenly) di `/admin/products`.
2. Checkout sebagai buyer, pilih **QRIS Otomatis** → QR muncul di `/pay/<code>`.
3. Bayar. Dalam beberapa detik order berubah **PAID** dan Telegram masuk.
4. Cek `/admin/orders` — `payment_id` berisi `order_code`, `paid_at` terisi.

### 7.3 Uji webhook tanpa membayar (curl bertanda tangan)

```bash
BODY='{"event":"payment.status_updated","data":{"order_id":"ORD-20260920-AB12CD","gross_amount":50000,"status":"paid","paid_at":"2026-09-20T07:10:00.000Z"},"timestamp":1788868200000}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$STENLY_WEBHOOK_SECRET" -hex | sed 's/^.* //')

curl -i -X POST https://DOMAIN-KAMU/api/webhooks/stenly \
  -H "Content-Type: application/json" \
  -H "X-Stenly-Signature: $SIG" \
  --data "$BODY"
# 200 {"received":true,"handled":"paid","reason":null}
```

Yang wajib kamu lihat saat menguji:

| Uji | Cara | Hasil yang benar |
| --- | --- | --- |
| Signature salah | ubah satu karakter `$SIG` | **403** `INVALID_SIGNATURE`, order tetap PENDING |
| Body diubah | kirim body lain dengan `$SIG` lama | **403**, order tetap PENDING |
| Nominal salah | `gross_amount` ≠ total order | 200 `handled:"ignored"`, order **tetap PENDING** |
| Webhook dobel | kirim request yang sama 2× | keduanya 200, Telegram **hanya sekali** |
| Expired | `"status":"expired"` | order menjadi EXPIRED |

Semua kasus di atas juga dikunci otomatis di `test/stenly-payment-flow.test.ts`.

---

## 8. Diagnosa dari dashboard admin

Buka **/admin/settings** → panel **Diagnosa QRIS Otomatis** (khusus admin,
endpoint `GET /api/admin/payments/diagnose`, 10 permintaan/10 menit). Panel ini:

* menampilkan status tiap env Stenly (`terisi`/`kosong`) dengan nilai
  **disamarkan** — API key & webhook secret penuh tidak pernah ditampilkan;
* menandai apakah key yang dipakai sandbox (`sk_test_`) atau produksi;
* menampilkan **Callback URL siap salin**;
* melakukan probe ringan ke Stenly (tidak menulis apa pun) dan menyimpulkan
  satu verdict beserta langkah perbaikannya.

Verdict yang mungkin: `OK_KEY_VALID`, `NOT_CONFIGURED`, `INVALID_API_KEY`,
`IP_NOT_ALLOWED`, `GATEWAY_NOT_READY`, `PROVIDER_UNREACHABLE`, `BAD_RESPONSE`,
`UNKNOWN`.

---

## 9. Troubleshooting

| Gejala | Penyebab paling sering | Perbaikan |
| --- | --- | --- |
| Opsi "QRIS Otomatis" ber-badge **Ongoing** | `STENLY_API_KEY`/`STENLY_WEBHOOK_SECRET` kosong di environment yang aktif | isi keduanya di Vercel → **Redeploy** |
| Checkout QRIS gagal, log `order_insert_payment_method_rejected` | database belum menjalankan `supabase/store/003_stenly_payment.sql` | jalankan migrasi itu di Supabase #2 → SQL Editor (§10) |
| HTTP 401 dari Stenly | header API key tidak terkirim | periksa env terisi & sudah redeploy |
| HTTP 403 dari Stenly | key milik project lain / project nonaktif / **IP tidak masuk whitelist** | salin ulang Secret Key project yang benar; kosongkan IP whitelist |
| HTTP 409 saat create | `order_id` sudah ada dengan nominal berbeda | jangan kirim ulang order lama dengan harga berubah; buat order baru |
| HTTP 422 | gateway QRIS project belum siap | selesaikan konfigurasi project di dashboard Stenly |
| QR tidak muncul, log `stenly_qr_string_missing` | respons charge tanpa `qr_string` | cek Transaction Detail di dashboard; buyer sementara bisa pakai tombol `payment_url` |
| Order tidak pernah PAID walau sudah dibayar | webhook tidak sampai | §9.1 |
| Webhook 403 terus di dashboard Stenly | `STENLY_WEBHOOK_SECRET` beda dengan project | salin ulang `whsec_…`, redeploy |

### 9.1 Memeriksa webhook

1. **Dashboard Stenly → Webhook Logs** (detail project): lihat status delivery
   tiap percobaan. `failed` di sini berarti masalahnya di sisi aplikasi/hosting.
   Tersedia tombol **resend** untuk mengirim ulang.
2. **Vercel → Runtime Logs**, cari event terstruktur:
   * `webhook_received` — payload sampai & signature sah;
   * `webhook_signature_invalid` — secret tidak cocok (atau request palsu);
   * `webhook_amount_mismatch` — nominal beda, sengaja tidak di-PAID;
   * `webhook_order_not_found` — `order_id` tidak dikenal database ini
     (sering terjadi bila satu project Stenly dipakai dua deployment).
3. **Deployment Protection** di Vercel harus mati untuk Production.
4. Pastikan Callback URL persis `https://DOMAIN/api/webhooks/stenly` (tanpa
   trailing slash, tanpa `www` yang salah).

### 9.2 Memeriksa satu transaksi

Kunci transaksi = `order_code` aplikasi (= `order_id` Stenly = `payment_id`).

```bash
curl -s https://stenly.id/api/v1/status/ORD-20260920-AB12CD \
  -H "x-api-key: $STENLY_API_KEY" | jq
```

Bandingkan `status` dan `gross_amount` dengan baris di `/admin/orders`. Kalau
Stenly bilang `paid` tetapi aplikasi masih PENDING, buka halaman `/pay/<code>`
sebagai pemilik order: polling akan menyinkronkan dalam ≤10 detik.

---

## 10. Database & kompatibilitas order lama

Kolom yang dipakai sudah ada sejak skema awal: `payment_id`, `payment_url`,
`qr_image_url`, `payment_expired_at`, `charged_amount`, `payment_status`,
`paid_at`, `last_payment_checked_at`. **Tidak ada kolom baru.**

Satu-satunya perubahan skema adalah CHECK constraint `payment_method`, yang
dulu hanya mengizinkan `('YOBASEPAY','MANUAL')`:

```
supabase/store/003_stenly_payment.sql
```

* Melonggarkan constraint menjadi `('STENLY','MANUAL','YOBASEPAY')` dan
  mengubah default kolom menjadi `'STENLY'`.
* **Tidak menyentuh satu pun baris order.** Nilai `'YOBASEPAY'` tetap sah, jadi
  seluruh histori transaksi lama tetap valid dan terbaca di dashboard (ditandai
  badge arsip di admin).
* Idempoten — aman dijalankan berulang, termasuk di project baru.

Jalankan di **Supabase #2 → SQL Editor**. Kalau belum dijalankan, checkout QRIS
otomatis membalas **503** dengan arahan memakai Transfer Manual (bukan 500), dan
SQL-nya ditampilkan di banner `/admin`.

---

## 11. Mengganti provider di kemudian hari

Abstraksinya sudah disiapkan untuk ini:

1. Buat `src/lib/integrations/payment/<provider>.ts` yang mengimplementasikan
   interface `PaymentProvider` (`src/lib/integrations/payment/types.ts`):
   `createPayment`, `checkStatus`, `verifyWebhookSignature`, `normalizeWebhook`.
2. Daftarkan di registry `src/lib/integrations/payment/index.ts`.
3. Tambahkan route `src/app/api/webhooks/<provider>/route.ts` (salin pola route
   Stenly: raw body → verifikasi signature → parse → normalisasi →
   `handleWebhookEvent`).
4. Tambahkan env `<PROVIDER>_*` di `src/lib/env.ts` + `.env.example`.

`src/lib/orders.ts` **tidak perlu diubah** — semua pemetaan nama field milik
provider tinggal di adapter dan `normalize.ts`.

---

## 12. Referensi cepat

* Dokumentasi resmi: <https://stenly.id/docs>
* Adapter: `src/lib/integrations/payment/stenly.ts`
* Normalisasi & pemetaan status: `src/lib/integrations/payment/normalize.ts`
* Render QR lokal: `src/lib/integrations/payment/qr-render.ts`
* Route webhook: `src/app/api/webhooks/stenly/route.ts`
* Diagnosa admin: `src/lib/integrations/payment/diagnose.ts` → panel di `/admin/settings`
* Migrasi DB: `supabase/store/003_stenly_payment.sql`
* Test: `test/stenly-adapter.test.ts`, `test/stenly-payment-flow.test.ts`,
  `test/payment-normalize.test.ts`
