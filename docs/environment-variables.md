# Environment Variables — arti, klasifikasi, dan dari mana nilainya

Semua var divalidasi terpusat di `src/lib/env.ts` (zod). Validasinya dibedakan
menurut risiko:

- **Kredensial** (URL & key Supabase) → **fail-fast**: app menolak jalan dengan
  pesan yang menyebut NAMA var yang hilang — bukan nilainya. Ini disengaja:
  lebih baik mati saat start daripada jalan setengah benar.
- **Preferensi** (`MANUAL_PAYMENT_ENABLED`, `WHATSAPP_SELLER_NUMBER`) →
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
| `MANUAL_PAYMENT_ENABLED` | 🖥 | — (default `true`) | Saklar global pembayaran manual (saklar kedua ada di `/admin/settings`). `false` = checkout ditolak. Nilai tak dikenal → `true` | `true` / `false` |
| `WHATSAPP_SELLER_NUMBER` | 🖥 | — (opsional) | **Cadangan** nomor WhatsApp penjual. Dipakai hanya bila kolom `manual_payment_settings.whatsapp_number` masih kosong; nomor di `/admin/settings` selalu menang. Nilai tidak valid ditolak saat dipakai (bukan saat dibaca) | `6281234567890` |
| `TELEGRAM_BOT_TOKEN` | 🔒🖥 | — (kosong = notifikasi skip) | Dari @BotFather (`/newbot`) | `123456789:AAExampleTokenFormatNotReal123` |
| `TELEGRAM_CHAT_ID` | 🖥 | — (berpasangan dengan token) | Chat ID penjual (lihat `docs/telegram.md`) | `987654321` atau `-1001234567890` (grup) |

> **Hanya satu metode pembayaran.** Toko ini tidak punya payment gateway:
> semua order baru dibuat sebagai transfer manual via WhatsApp. Metode dianggap
> siap bila `MANUAL_PAYMENT_ENABLED=true` **dan** saklar di `/admin/settings`
> aktif **dan** ada nomor WhatsApp (dari DB, atau dari
> `WHATSAPP_SELLER_NUMBER` sebagai cadangan). Bila belum siap, `/checkout`
> menampilkan "Pembayaran belum tersedia" + alasan, dan `POST /api/orders`
> membalas **503** — bukan error 500. Detail: `docs/manual-payment.md`.
>
> **Kenapa nomor WA boleh di env:** deploy pertama sering terjadi sebelum penjual
> sempat membuka dashboard. Env menyelamatkan checkout, tetapi begitu nomor
> disimpan di `/admin/settings`, nilai env tidak lagi dipakai (kode melaporkan
> `numberFromDatabase: true` di panel status).

> **Variabel provider QRIS sudah dihapus — jangan ditambahkan kembali.**
> `STENLY_API_KEY`, `STENLY_WEBHOOK_SECRET`, `STENLY_BASE_URL`,
> `STENLY_EXPIRY_MINUTES`, `DEFAULT_PAYMENT_METHOD`, dan
> `MANUAL_PAYMENT_QR_IMAGE_URL` tidak lagi dibaca kode mana pun; membiarkannya
> terisi di Vercel pun tidak berpengaruh (kode tidak menghapusnya, tapi juga
> tidak memakainya). Endpoint `/api/webhooks/stenly` dan `/api/manual-qr` sudah
> tidak ada, jadi callback dari provider akan menerima 404 — matikan webhook di
> dashboard provider agar tidak menumpuk retry. Order lama dari masa QRIS
> otomatis tetap tersimpan & terbaca (`payment_method = 'STENLY'`/`'YOBASEPAY'`).

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
