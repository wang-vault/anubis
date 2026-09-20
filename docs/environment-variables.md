# Environment Variables — arti, klasifikasi, dan dari mana nilainya

Semua var divalidasi terpusat di `src/lib/env.ts` (zod). Validasinya dibedakan
menurut risiko:

- **Kredensial** (URL & key Supabase) → **fail-fast**: app menolak jalan dengan
  pesan yang menyebut NAMA var yang hilang — bukan nilainya. Ini disengaja:
  lebih baik mati saat start daripada jalan setengah benar.
- **Preferensi** (`DEFAULT_PAYMENT_METHOD`, `MANUAL_PAYMENT_ENABLED`) →
  **toleran**: kapitalisasi/spasi diabaikan (`manual`, ` MANUAL ` → `MANUAL`),
  dan nilai tak dikenal jatuh ke default yang aman.

> Kenapa preferensi tidak ikut fail-fast: `serverEnv()` dipanggil lewat
> `lib/supabase/server.ts` oleh hampir semua halaman — termasuk katalog publik
> dan login. Kalau preferensi ikut melempar, satu salah ketik pada var
> pembayaran akan membuat **seluruh situs** balas 500, bukan cuma checkout.

Klasifikasi:
- 🌐 **PUBLIC** — wajib prefix `NEXT_PUBLIC_`, ikut ter-bundle ke browser.
  Aman dipublik (anon key Supabase hanya bisa melakukan apa yang RLS izinkan).
- 🖥 **SERVER** — tanpa prefix, hanya terbaca di runtime Vercel/Node.
- 🔒 **SECRET** — server + rahasia. Jangan pernah di-print, di-log, atau dikirim ke client.

| Variabel | Kelas | Wajib | Dari mana | Contoh format |
|---|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | 🌐 | ✔ | URL publik situs Anda | `https://toko.anda.com` (tanpa `/` di akhir) |
| `NEXT_PUBLIC_SITE_NAME` | 🌐 | — (default `Toko Saya`) | Nama toko untuk header/title/pesan WA | `Toko Kopi Budi` |
| `NEXT_PUBLIC_SUPABASE_ACCOUNT_URL` | 🌐 | ✔ | Supabase #1 → Settings → API → Project URL | `https://abcdefghijkl.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ACCOUNT_ANON_KEY` | 🌐 | ✔ | Supabase #1 → Settings → API → `anon` / `publishable` key | `sb_publishable_…` atau JWT `eyJ…` (panjang) |
| `SUPABASE_ACCOUNT_SERVICE_ROLE_KEY` | 🔒🖥 | ✔ | Supabase #1 → API → `service_role` key | JWT panjang |
| `NEXT_PUBLIC_SUPABASE_STORE_URL` | 🌐 | ✔ | Supabase #2 → Settings → API → Project URL | `https://mnopqrstuvwx.supabase.co` |
| `SUPABASE_STORE_SERVICE_ROLE_KEY` | 🔒🖥 | ✔ | Supabase #2 → API → `service_role` | JWT panjang |
| `NEXT_PUBLIC_SUPABASE_STORE_ANON_KEY` | 🌐 | — (opsional) | Supabase #2 → `anon`. MVP tidak membacanya dari browser (semua akses toko via server) — kosongkan kecuali nanti ingin query katalog langsung dari client | sama formatnya |
| `DEFAULT_PAYMENT_METHOD` | 🖥 | — (default `MANUAL`) | Metode default saat order dibuat TANPA field `paymentMethod` (jalur API): `MANUAL` / `STENLY`. Toleran kapitalisasi; nilai lama `YOBASEPAY`/`AUTO` dibaca sebagai `STENLY`; nilai tak dikenal → `MANUAL`. Halaman checkout sendiri selalu default ke Transfer Manual bila tersedia (opsi QRIS tampil "Ongoing" hanya saat env Stenly belum terisi) | `MANUAL` |
| `MANUAL_PAYMENT_ENABLED` | 🖥 | — (default `true`) | Saklar global metode transfer manual (saklar kedua ada di `/admin/settings`). Nilai tak dikenal → `true` | `true` / `false` |
| `MANUAL_PAYMENT_QR_IMAGE_URL` | 🖥 | — (opsional) | URL https gambar QR statis bila kamu host sendiri; mengalahkan gambar yang di-upload dari dashboard | `https://cdn.anda/qris.png` |
| `STENLY_API_KEY` | 🔒🖥 | — (kosong = integrasi QRIS otomatis nonaktif) | Dashboard Stenly → detail project → **Secret Key**. Dikirim sebagai header `x-api-key` | `sk_live_…` (sandbox: `sk_test_…`) |
| `STENLY_WEBHOOK_SECRET` | 🔒🖥 | — (kosong = webhook ditolak 403) | Dashboard Stenly → detail project → **Webhook Secret**. HMAC-SHA256 atas raw body, header `X-Stenly-Signature` | `whsec_…` |
| `STENLY_BASE_URL` | 🖥 | — (default `https://stenly.id`) | Base URL REST API (tanpa trailing slash). Endpoint: `POST /api/v1/charge`, `GET /api/v1/status/:order_id` | `https://stenly.id` |
| `STENLY_EXPIRY_MINUTES` | 🖥 | — (default `15`) | Masa aktif QRIS, dikirim sebagai `expiry_minutes`. Rentang diterima 1–1440 | `15` |
| `TELEGRAM_BOT_TOKEN` | 🔒🖥 | — (kosong = notifikasi skip) | Dari @BotFather (`/newbot`) | `123456789:AAExampleTokenFormatNotReal123` |
| `TELEGRAM_CHAT_ID` | 🖥 | — (berpasangan dengan token) | Chat ID penjual (lihat `docs/telegram.md`) | `987654321` atau `-1001234567890` (grup) |

> **Kombinasi metode pembayaran.** Toko butuh minimal SATU metode aktif:
> pembayaran manual (gambar QR diunggah via `/admin/settings` +
> `MANUAL_PAYMENT_ENABLED=true`) atau QRIS otomatis (kedua var Stenly terisi).
> Bila dua-duanya mati, `/checkout` menampilkan "Pembayaran belum tersedia"
> (bukan error). Detail: `docs/manual-payment.md`.
>
> Catatan tampilan checkout: opsi "QRIS Otomatis" **bisa dipilih buyer** bila
> `STENLY_API_KEY` **dan** `STENLY_WEBHOOK_SECRET` terisi; bila salah
> satu kosong, opsi itu ditampilkan **disabled dengan badge "Ongoing"**
> (dibangun `getCheckoutPaymentMethods()`) dan pembeli memakai Transfer
> Manual. Sumbernya sama dengan ketersediaan level server (webhook, polling,
> `POST /api/orders`) — lihat baris di atas — jadi keduanya tidak pernah
> bertentangan.

> **Variabel Stenly yang TIDAK ada — jangan ditambahkan.**
> `STENLY_WEBHOOK_URL` (URL callback dihitung dari `NEXT_PUBLIC_SITE_URL` +
> `/api/webhooks/stenly` dan ditampilkan siap-salin di `/admin/settings`),
> `STENLY_AMOUNT_TOLERANCE` (QRIS Stenly menagih nominal persis → toleransi 0,
> konstanta di kode; kode unik hanya untuk metode manual), `STENLY_QR_RENDER_URL`
> (QR dirender lokal dari `qr_string` dengan paket `qrcode`), dan
> `STENLY_EXPIRY_TZ_OFFSET` (`expires_at` sudah ISO-8601 UTC berakhiran `Z`).
> `NEXT_PUBLIC_STENLY_*` **dilarang** — semua kredensial Stenly server-only.
> Detail: `docs/stenly.md`.

## Aturan yang ditegakkan proyek

1. **Secret tidak pernah berawalan `NEXT_PUBLIC_`** — kode ini tidak membaca
   service role/API key/secret dari mana pun selain `process.env` di modul
   server (`import "server-only"` mencegah kebocoran ke bundle).
2. **Jangan commit `.env`/`.env.local`** — sudah di `.gitignore`; yang di repo
   hanya `.env.example` (placeholder, tanpa kredensial nyata).
3. Di **Vercel**: Project → Settings → Environment Variables; tipe:
   - `Production, Preview, Development` untuk semua di atas.
   - Jangan mencentang "Sensitive" untuk var yang perlu dibaca build-time?
     Aman-aman saja — build Vercel punya akses ke semua env.
4. Mengubah env di Vercel → **Redeploy** agar runtime memakai nilai baru.

## Cara memverifikasi env terbaca (Vercel)

Buka log deployment (`Deployments → … → View build function logs / Runtime logs`).
Bila salah satu var wajib kosong, app menampilkan error internal + log berisi:
`Konfigurasi environment tidak valid… NEXT_PUBLIC_SUPABASE_ACCOUNT_URL: Required`
— artinya nama var itu **belum dibuat / salah nama / salah scope**.
