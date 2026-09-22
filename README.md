# Anubis Store — Toko Online Transfer Manual via WhatsApp

Toko online **ringan, cepat, aman, dan tanpa VPS** untuk penjual tunggal:

> Buyer daftar → verifikasi email → beli produk → checkout → **chat penjual di
> WhatsApp** untuk menerima detail pembayaran (QRIS statis / rekening /
> e-wallet) → transfer dengan nominal **+ kode unik** → tekan "Saya sudah
> transfer" → penjual verifikasi mutasi → status **LUNAS** → penjual dapat
> **notifikasi Telegram** → barang diproses → tandai **Selesai**.

Toko ini punya **satu metode bayar saja: transfer manual yang dikoordinasikan
lewat WhatsApp**. Tidak ada payment gateway, tidak ada QRIS otomatis, tidak ada
webhook, tidak ada upload gambar QR di aplikasi — semua detail pembayaran
dikirim penjual **di dalam chat**, jadi selalu yang terbaru dan tidak pernah
basi. Panduan lengkap: `docs/manual-payment.md`.

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
| Pembayaran | **Transfer manual via WhatsApp** (satu-satunya) | Nomor WA penjual diatur di `/admin/settings` (kolom DB, ada cadangan env). Buyer chat → penjual kirim detail → buyer klaim → penjual konfirmasi dari mutasi → PAID. Tidak ada provider/webhook |
| Notifikasi | **Telegram Bot API** (ke penjual saja) | Klaim transfer & order lunas; gagal kirim ≠ pembayaran gagal |
| Keamanan tambahan | **Cloudflare (opsional)** DNS/proxy/WAF/rate limit | Lihat `docs/cloudflare.md` |

**Pencarian produk** ada di dua tempat dengan mesin yang sama
(`src/lib/product-search.ts`): katalog pembeli `/products` dan daftar produk
penjual `/admin/products`. Bentuknya form GET (`?q=…`) — tanpa JS klien, hasil
bisa di-bookmark, dan filter dikerjakan di memori atas daftar produk yang sudah
dibaca server (nama + deskripsi + harga, min 2 huruf, hasil disorot).

## Arsitektur (satu halaman)

```
                  ┌─────────────── Vercel (Next.js) ───────────────┐
 Browser          │  Pages (SSR)          API Routes / Actions     │
 ┌──────┐  HTTPS  │  /products, /checkout → POST /api/orders       │
 │ Buyer│────────▶│  /pay/[code]  ───────── GET /api/payments/status│
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
                  ┌──────────────┐  ┌────────────────────┐
   wa.me link     │ WhatsApp     │  │ Telegram Bot       │
  (buyer→penjual) │ chat manual  │  │ (penjual saja)     │
                  │ detail bayar │  │ klaim & lunas      │
                  └──────────────┘  └────────────────────┘
```

**Aturan emas yang ditegakkan kode:**

1. Harga SELALU dibaca server-side dari Supabase #2 — body klien tidak dipercaya.
2. Order menjadi `PAID` **HANYA** oleh konfirmasi penjual di dashboard setelah
   uangnya dicek di mutasi. Klaim "saya sudah transfer" dari buyer hanya
   membuat antrian verifikasi, tidak pernah mengubah status.
3. Nominal tagihan = total order **+ kode unik 1–999** yang deterministik dari
   kode order, supaya transfer buyer mudah dicocokkan di mutasi.
4. Notifikasi Telegram "diklaim" sekali (kolom `manual_claim_notified_at`), dan
   "LUNAS" sekali (kolom `telegram_notified_at`).
5. Telegram gagal → pembayaran tetap PAID, error dicatat.
6. Role admin diverifikasi server-side dari kolom `profiles.role` + RLS.
7. Service role key tidak pernah masuk bundle browser (diproteksi `server-only`).

## Struktur Dokumen

| File | Isi |
|---|---|
| `docs/architecture.md` | Arsitektur, alur data, model keamanan, penjelasan per folder |
| `docs/setup.md` | Jalankan di laptop (local dev) dari nol |
| `docs/environment-variables.md` | Semua env var: public/server/secret + dari mana nilainya |
| `docs/deployment.md` | Deploy ke Vercel langkah A–O (klik per klik) |
| `docs/supabase-account.md` | Supabase #1: auth, email verification, RLS, akun admin pertama |
| `docs/supabase-store.md` | Supabase #2: schema toko, RLS, testing |
| `docs/manual-payment.md` | Pembayaran manual via WhatsApp: nomor penjual, kode unik nominal, template pesan, alur verifikasi, masa berlaku order |
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
│   ├── (halaman publik)     page.tsx, products/, testimoni/, checkout/, pay/, orders/, auth/
│   ├── admin/               login + (panel)/ dashboard, orders, products, settings
│   │   └── (panel)/*        guard role admin di layout + ulang di setiap aksi
│   └── api/
│       ├── orders/          POST buat order, GET list
│       ├── orders/[code]/   GET detail + /status (polling ringan)
│       ├── payments/status/ GET status order untuk polling halaman /pay (tanpa provider)
│       └── admin/           CRUD produk & transisi order (hanya role admin)
├── lib/
│   ├── env.ts               validasi env (fail-fast) — satu-satunya tempat baca process.env
│   ├── payment-methods.ts   metode bayar + kode unik nominal (murni, ter-unit-test)
│   ├── payment-config.ts    konfigurasi pembayaran manual (nomor WA penjual dari DB)
│   ├── whatsapp.ts          template pesan & link wa.me (murni, ter-unit-test)
│   ├── orders.ts            DOMAIN LOGIC: create order, state machine, idempotensi, statistik
│   ├── products.ts          katalog + cache tag 'products' (60 dtk, revalidasi saat admin ubah)
│   ├── product-search.ts    pencarian produk murni (katalog publik + dashboard penjual) — filter di memori, aman dari metakarakter PostgREST
│   ├── authz.ts             requireUser / requireVerifiedUser / requireAdmin (server-side)
│   ├── auth-redirects.ts    aturan routing halaman auth (tamu/login/belum-verifikasi/baru-daftar) — murni, dipakai middleware + guard
│   ├── auth-guards.ts       guardAuthPage: pengulangan aturan itu di Server Component (defense-in-depth)
│   ├── testimonials.ts      testimoni otomatis dari order DONE (publik, maks 20, kolom non-sensitif saja)
│   ├── supabase/            klien server (anon, service-role) — dijamin tak masuk bundle browser
│   ├── integrations/        telegram.ts (satu-satunya integrasi eksternal)
│   ├── api.ts               HttpError + handler terpusat (pesan user aman, detail ke log)
│   ├── validation.ts        zod: semua input tervalidasi
│   ├── phone.ts money.ts order-code.ts dates.ts ratelimit.ts logger.ts store-schema.ts
├── components/              UI server + beberapa komponen klien (form, PaymentPanel)
└── middleware.ts            refresh cookie session + gate rute login-only

supabase/
├── account/001_schema.sql   ▶ jalankan di Supabase #1
└── store/001_schema.sql     ▶ jalankan di Supabase #2
    store/002_manual_payment.sql ▶ migrasi pembayaran manual (untuk DB lama)
    store/004_whatsapp_payment.sql ▶ migrasi nomor WA penjual + default MANUAL (wajib untuk DB lama)
```

## Mulai Cepat

```bash
# 1. Install
npm install

# 2. Siapkan 2 project Supabase + jalankan SQL (Lengkap: docs/deployment.md)
#    - salin supabase/account/001_schema.sql ke SQL Editor Supabase #1
#    - salin supabase/store/001_schema.sql  ke SQL Editor Supabase #2
#    - salin supabase/store/002_manual_payment.sql + 004_whatsapp_payment.sql
#      (wajib untuk project lama; aman dijalankan berulang, tidak menghapus data)

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
> `MANUAL_PAYMENT_ENABLED` (default aktif) mematikan seluruh checkout bila
> diisi `false`; `WHATSAPP_SELLER_NUMBER` hanya **cadangan** bila kolom nomor
> WhatsApp di database masih kosong. `TELEGRAM_*` opsional (skip + log bila
> kosong). Penjelasan tiap variabel: `docs/environment-variables.md`.
>
> **Setelah deploy**: buka `/admin/settings` → isi **nomor WhatsApp penjual** →
> metode Transfer via WhatsApp langsung aktif tanpa deploy ulang. Selama nomor
> belum diisi, checkout ditolak dengan pesan jelas (bukan gagal senyap).

## Tanpa provider — kenapa pembayaran dikirim di chat

Dulu aplikasi ini punya dua jalur: **QRIS otomatis** (payment gateway + webhook
HMAC) dan **QRIS statis** yang gambarnya di-upload ke DB lalu ditampilkan di
halaman `/pay`. Keduanya dihapus. Sekarang:

- **Satu sumber kebenaran pembayaran:** mutasi rekening/e-wallet penjual.
- **Detail pembayaran tidak disimpan di aplikasi.** Penjual mengirim QRIS
  statis / nomor rekening / e-wallet langsung di chat, jadi bisa berganti kapan
  saja tanpa deploy — dan tidak ada gambar atau nomor rekening tertinggal di
  riwayat halaman pembeli.
- **Buyer selalu chat dulu.** Tombol di `/pay/[code]` membuka WhatsApp dengan
  pesan siap kirim berisi kode order, produk, dan nominal tagihan (template
  bisa diubah di `/admin/settings`).
- **Klaim ≠ lunas.** Buyer menekan "Saya sudah transfer" (opsional mengisi nama
  pengirim / nomor referensi) → masuk antrian verifikasi + notifikasi Telegram.
  Penjual cek mutasi → tombol **Konfirmasi Pembayaran** → PAID. Nominal masuk
  bisa dicatat di kolom `charged_amount`.
- **Order kadaluarsa** otomatis (default 120 menit, diatur penjual) bila belum
  diklaim; order yang sudah diklaim tidak pernah kadaluarsa.

> **Order dari masa QRIS otomatis.** Order lama tetap utuh dan tetap terbaca di
> dashboard: `payment_method = 'YOBASEPAY'` (provider pertama) atau `'STENLY'`
> (provider kedua) kini berlabel **"QRIS Otomatis (lama)"**, hanya bisa dilihat
> (tidak bisa dikonfirmasi lewat jalur manual). Constraint database tetap
> mengizinkan kedua nilai itu, dan tidak ada satu baris pun yang ditulis ulang
> oleh migrasi `004_whatsapp_payment.sql`. File `003_stenly_payment.sql` hanya
> disimpan sebagai riwayat migrasi.

## Keamanan (ringkas)

- RLS aktif di SEMUA tabel. Orders = deny-by-default: browser mustahil
  membaca/menulis langsung; akses lewat API yang cek session + kepemilikan + role.
- Buyer tidak bisa: mengubah `payment_status`/`order_status`/harga, melihat
  order orang lain, membuka `/admin`, atau melunasi ordernya sendiri.
- Trigger DB memblokir perubahan `role` oleh user login (anti privilege escalation).
- Rate limit best-effort di app (order & klaim transfer) + Cloudflare (disarankan)
  di edge.
- Pesan kesalahan yang dilihat user tidak pernah memuat detail database; detail
  lengkap hanya ke log server.
- `.env` di-gitignore; audit secret sebelum push: `grep -RiE 'service_role|TELEGRAM_BOT_TOKEN' src/ | grep -v 'process.env'`.

Full model: **`docs/security.md`** · Checklist produksi: **`docs/testing.md`**.
