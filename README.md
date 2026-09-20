# Anubis Store — Toko Online QRIS Sederhana

Toko online **ringan, cepat, aman, dan tanpa VPS** untuk penjual tunggal:

> Buyer daftar → verifikasi email → beli produk → bayar **QRIS** → status lunas
> terverifikasi → penjual dapat **notifikasi Telegram** → penjual proses →
> chat **WhatsApp** buyer → tandai **Selesai**.
>
> Dua metode bayar, keduanya bisa dipilih buyer di halaman checkout:
> **Transfer Manual** (QRIS statis milik penjual — mis. QR GoPay Merchant —
> diverifikasi penjual dari mutasi) yang jadi pilihan default, dan **QRIS
> Otomatis** (Stenly + webhook; status lunas terdeteksi sistem). QRIS
> Otomatis tampil **"Ongoing"** (tidak bisa dipilih) hanya selama kredensial
> `STENLY_API_KEY` + `STENLY_WEBHOOK_SECRET` belum terisi. Panduan
> lengkap: `docs/stenly.md` dan `docs/manual-payment.md`.

Tidak ada marketplace, tidak ada keranjang rumit, tidak ada WhatsApp OTP,
tidak ada VPS. Semuanya serverless di Vercel.

---

## Tech Stack

| Bagian | Teknologi | Catatan |
|---|---|---|
| Web (SSR + API) | **Next.js 15 (App Router) + TypeScript strict** | Render di server, JS klien minimal (First Load ~106 kB) |
| Hosting | **Vercel** (serverless) | Tanpa VPS |
| Akun & Auth | **Supabase #1** (Auth + `profiles`) | Register/login/email verification/password reset lewat Supabase Auth — tidak ada sistem password buatan sendiri |
| Toko | **Supabase #2** (`products`, `orders`) | Terpisah; harga & status ditegakkan server-side |
| Pembayaran #1 | **Stenly** (payment gateway QRIS) + webhook HMAC | QRIS dinamis: `POST /api/v1/charge` → QR, webhook bertanda tangan saat lunas. **Opsional**: kredensial terisi → bisa dipilih buyer di checkout; kosong → integrasi nonaktif dan opsi ber-badge "Ongoing" (tidak bisa dipilih) |
| Pembayaran #2 | **Transfer Manual** (QRIS statis penjual, mis. QR GoPay Merchant) | Tanpa provider: buyer scan QR + transfer + konfirmasi, penjual verifikasi mutasi → `docs/manual-payment.md` |
| Notifikasi | **Telegram Bot API** (ke penjual saja) | Gagal kirim ≠ pembayaran gagal |
| Keamanan tambahan | **Cloudflare (opsional)** DNS/proxy/WAF/rate limit | Lihat `docs/cloudflare.md` |

## Arsitektur (satu halaman)

```
                  ┌─────────────── Vercel (Next.js) ───────────────┐
 Browser          │  Pages (SSR)          API Routes / Actions     │
 ┌──────┐  HTTPS  │  /products, /checkout → POST /api/orders       │
 │ Buyer│────────▶│  /pay/[code]  ───────── GET /api/payments/*    │
 └──────┘         │  /orders, /admin/* ──── PATCH /api/admin/*     │
                  │        │                        │               │
                  └────────┼────────────────────────┼───────────────┘
                           ▼                        ▼
                  ┌────────────────┐      ┌─────────────────────┐
                  │ SUPABASE #1    │      │ SUPABASE #2         │
                  │ AUTH + profiles│      │ products, orders    │
                  │ RLS: own row   │      │ RLS: deny-all +     │
                  └────────────────┘      │ products publik-read│
                                          └─────────────────────┘
                  ┌────────────────┐      ┌──────────────┐  ┌──────────┐
   webhook HMAC   │ STENLY         │      │ Telegram Bot │  │ WhatsApp │
  ───────────────▶│ /v1/charge     │      │ (penjual     │  │ (manual, │
  PAID / EXPIRED  │ /v1/status     │      │  saja)       │  │  link)   │
                  └────────────────┘      └──────────────┘  └──────────┘
```

**Aturan emas yang ditegakkan kode:**

1. Harga SELALU dibaca server-side dari Supabase #2 — body klien tidak dipercaya.
2. Order menjadi `PAID` HANYA oleh webhook bertanda tangan sah, cek status
   server-side ke Stenly, ATAU konfirmasi penjual (pembayaran manual) —
   tidak pernah oleh tombol/di browser. Klaim "saya sudah transfer" hanya
   membuat antrian verifikasi, bukan status lunas.
3. Webhook **idempotent**: nominal divalidasi, transisi status bersyarat,
   notifikasi Telegram "diklaim" sekali (kolom `telegram_notified_at`).
4. Telegram gagal → pembayaran tetap PAID, error dicatat.
5. Role admin diverifikasi server-side dari kolom `profiles.role` + RLS.
6. Service role key tidak pernah masuk bundle browser (diproteksi `server-only`).

## Struktur Dokumen

| File | Isi |
|---|---|
| `docs/architecture.md` | Arsitektur, alur data, model keamanan, penjelasan per folder |
| `docs/setup.md` | Jalankan di laptop (local dev) dari nol |
| `docs/environment-variables.md` | Semua env var: public/server/secret + dari mana nilainya |
| `docs/deployment.md` | Deploy ke Vercel langkah A–O (klik per klik) |
| `docs/supabase-account.md` | Supabase #1: auth, email verification, RLS, akun admin pertama |
| `docs/supabase-store.md` | Supabase #2: schema toko, RLS, testing |
| `docs/stenly.md` | Registrasi, API key, webhook secret & callback URL, payment flow, sandbox, troubleshooting, ganti provider |
| `docs/manual-payment.md` | Pembayaran manual: upload QR, kode unik nominal, alur verifikasi penjual, kapan opsi QRIS "Ongoing" |
| `docs/telegram.md` | Buat bot dari nol, ambil chat ID, test notifikasi |
| `docs/api.md` | Kontrak semua endpoint API |
| `docs/admin-guide.md` | Manual owner/penjual setelah deploy (A–O) |
| `docs/buyer-guide.md` | Manual buyer |
| `docs/testing.md` | Checklist test end-to-end sebelum produksi |
| `docs/security.md` | Model keamanan + checklist produksi |
| `docs/troubleshooting.md` | 12+ kasus masalah umum + cara cek + solusi |
| `docs/cloudflare.md` | Kapan Cloudflare perlu / tidak perlu |

## Struktur Sumber Kode

```
src/
├── app/
│   ├── (halaman publik)     page.tsx, products/, checkout/, pay/, orders/, auth/
│   ├── admin/               login + (panel)/ dashboard, orders, products
│   │   └── (panel)/*        guard role admin di layout + ulang di setiap aksi
│   └── api/
│       ├── orders/          POST buat order, GET list
│       ├── orders/[code]/   GET detail + /status (polling ringan)
│       ├── payments/status/ GET sinkronisasi ke provider (throttled)
│       ├── manual-qr/       GET gambar QRIS statis penjual (base64 dari DB)
│       ├── webhooks/stenly/ POST callback pembayaran (sumber kebenaran)
│       └── admin/           CRUD produk & transisi order (hanya role admin)
├── lib/
│   ├── env.ts               validasi env (fail-fast) — satu-satunya tempat baca process.env
│   ├── payment-methods.ts   metode bayar + kode unik nominal (murni, ter-unit-test)
│   ├── payment-config.ts    konfigurasi pembayaran manual + metode yang tersedia
│   ├── orders.ts            DOMAIN LOGIC: create order, state machine, idempotensi, statistik
│   ├── products.ts          katalog + cache tag 'products' (60 dtk, revalidasi saat admin ubah)
│   ├── authz.ts             requireUser / requireVerifiedUser / requireAdmin (server-side)
│   ├── supabase/            klien server (anon, service-role) — dijamin tak masuk bundle browser
│   ├── integrations/        abstraction layer: payment/ (Stenly), telegram.ts
│   ├── api.ts               HttpError + handler terpusat (pesan user aman, detail ke log)
│   ├── validation.ts        zod: semua input tervalidasi
│   ├── phone.ts money.ts order-code.ts dates.ts ratelimit.ts logger.ts
├── components/              UI server + beberapa komponen klien (form, payment panel)
└── middleware.ts            refresh cookie session + gate rute login-only

supabase/
├── account/001_schema.sql   ▶ jalankan di Supabase #1
└── store/001_schema.sql     ▶ jalankan di Supabase #2
    store/002_manual_payment.sql ▶ jalankan JUGA di Supabase #2 (migrasi idempoten)
```

## Mulai Cepat

```bash
# 1. Install
npm install

# 2. Siapkan 2 project Supabase + jalankan SQL (Lengkap: docs/deployment.md)
#    - salin supabase/account/001_schema.sql ke SQL Editor Supabase #1
#    - salin supabase/store/001_schema.sql  ke SQL Editor Supabase #2
#    - salin supabase/store/002_manual_payment.sql ke SQL Editor Supabase #2
#      (wajib untuk project lama; aman dijalankan berulang)

# 3. Konfigurasi env
cp .env.example .env.local       # isi URL + keys (tanpa ini app tidak jalan)

# 4. Jalan
npm run dev                       # http://localhost:3000
npm test                          # unit test murni (logic kritis)
npm run typecheck && npm run build
```

> **Env wajib** saat build/run: `NEXT_PUBLIC_SUPABASE_ACCOUNT_URL`,
> `NEXT_PUBLIC_SUPABASE_ACCOUNT_ANON_KEY`, `SUPABASE_ACCOUNT_SERVICE_ROLE_KEY`,
> `NEXT_PUBLIC_SUPABASE_STORE_URL`, `SUPABASE_STORE_SERVICE_ROLE_KEY`.
> `STENLY_*` opsional (kosong = integrasi QRIS otomatis nonaktif — opsi di
> checkout tampil ber-badge **"Ongoing"** dan tidak bisa dipilih, toko tetap
> jalan dengan pembayaran manual; terisi = opsi itu ikut bisa dipilih buyer);
> `TELEGRAM_*` opsional (skip + log bila kosong). Penjelasan tiap variabel:
> `docs/environment-variables.md`.
>
> **Setelah deploy**: buka `/admin/settings` → unggah gambar QRIS statis kamu →
> metode Transfer Manual langsung aktif tanpa deploy ulang.

## Integrasi Stenly — catatan penting

**Stenly** (<https://stenly.id>) adalah payment gateway QRIS: aplikasi memanggil
`POST /api/v1/charge` dan menerima QR dinamis dengan nominal **persis** sesuai
total order (tidak ada kode unik, jadi toleransi nominal = 0). Status lunas
datang lewat **webhook bertanda tangan HMAC-SHA256** ke
`/api/webhooks/stenly`, dengan `GET /api/v1/status/:order_id` sebagai cadangan
(throttle 1 cek / 10 detik / order).

Dua keputusan yang perlu diketahui:

- **`payment_id` = `order_code`.** Stenly tidak memberi ID transaksi terpisah —
  kunci transaksinya adalah `order_id` yang kita kirim.
- **QR dirender lokal.** `qr_image_url` dari Stenly menyertakan `api_key` di
  query string, jadi tidak pernah dikirim ke browser; aplikasi merender
  `qr_string` (EMVCo) menjadi PNG data-URI di server dengan paket `qrcode` —
  payload tidak pernah dikirim ke layanan QR pihak ketiga.

Seluruh kontrak API ditulis terhadap dokumentasi resmi <https://stenly.id/docs>
dan dirangkum di `docs/stenly.md`.

**Perilaku QRIS Otomatis saat ini:** opsi ini mengikuti kredensial. Selama
`STENLY_API_KEY` / `STENLY_WEBHOOK_SECRET` kosong, pembeli di halaman
checkout memakai **Transfer Manual** dan opsi "QRIS Otomatis" tampil non-aktif
dengan badge **"Ongoing"**. Isi keduanya bila akun sudah aktif → integrasi sisi
server (webhook, cek status, order via `POST /api/orders`) **dan** pilihan di
UI checkout hidup bersamaan, tanpa perubahan kode (logikanya terpusat di
`getCheckoutPaymentMethods()`, `src/lib/payment-config.ts`).

> **Migrasi dari YoBasePay.** Provider lama sudah dihapus dari kode. Order lama
> tetap tersimpan apa adanya (`payment_method = 'YOBASEPAY'`) dan tetap terbaca
> di dashboard. Jalankan `supabase/store/003_stenly_payment.sql` di Supabase #2
> agar nilai `'STENLY'` diterima database — migrasinya idempoten dan tidak
> menyentuh satu pun baris order.

## Keamanan (ringkas)

- RLS aktif di SEMUA tabel. Orders = deny-by-default: browser mustahil
  membaca/menulis langsung; akses lewat API yang cek session + kepemilikan + role.
- Buyer tidak bisa: mengubah `payment_status`/`order_status`/harga, melihat
  order orang lain, membuka `/admin`.
- Trigger DB memblokir perubahan `role` oleh user login (anti privilege escalation).
- Webhook: raw-body HMAC-SHA256 + perbandingan constant-time + validasi nominal
  + idempoten. Rate limit best-effort di app + Cloudflare (disarankan) di edge.
- `.env` di-gitignore; audit secret sebelum push: `grep -RiE 'service_role|STENLY_API_KEY|STENLY_WEBHOOK_SECRET|TELEGRAM_BOT_TOKEN' src/ | grep -v 'process.env'`.

Full model: **`docs/security.md`** · Checklist produksi: **`docs/testing.md`**.
