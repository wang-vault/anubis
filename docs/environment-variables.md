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
| `DEFAULT_PAYMENT_METHOD` | 🖥 | — (default `MANUAL`) | Metode terpilih default di checkout: `MANUAL` / `YOBASEPAY`. Toleran kapitalisasi; nilai tak dikenal → `MANUAL` | `MANUAL` |
| `MANUAL_PAYMENT_ENABLED` | 🖥 | — (default `true`) | Saklar global metode transfer manual (saklar kedua ada di `/admin/settings`). Nilai tak dikenal → `true` | `true` / `false` |
| `MANUAL_PAYMENT_QR_IMAGE_URL` | 🖥 | — (opsional) | URL https gambar QR statis bila kamu host sendiri; mengalahkan gambar yang di-upload dari dashboard | `https://cdn.anda/qris.png` |
| `YOBASEPAY_API_KEY` | 🔒🖥 | — (kosong = QRIS otomatis nonaktif) | Dashboard YoBasePay → project/API key (dipakai sebagai `apikey`) | sesuai dashboard |
| `YOBASEPAY_WEBHOOK_SECRET` | 🔒🖥 | — (kosong = webhook ditolak 403) | Dashboard YoBasePay → Webhook secret (untuk HMAC `X-YoBasePay-Signature`) | string |
| `YOBASEPAY_BASE_URL` | 🖥 | — (default `https://yobasepay.net/api`) | Dokumentasi API di dashboard akun Anda — bila versi V3/V4 memakai path berbeda | `https://yobasepay.net/api` |
| `YOBASEPAY_AMOUNT_TOLERANCE` | 🖥 | — (default `999`) | Toleransi kode unik nominal. V1/V2 (+1..999): `999`. V3 no-unique-code: `0` | `999` |
| `YOBASEPAY_EXPIRY_TZ_OFFSET` | 🖥 | — (default `+07:00`) | Offset zona waktu field `expired_at` provider (dokumentasi tidak menyebut zona) | `+07:00` |
| `YOBASEPAY_QR_RENDER_URL` | 🖥 | — (opsional, default kosong) | Template layanan pembuat gambar QR, dipakai HANYA bila provider mengirim payload QRIS (string EMVCo) alih-alih gambar. Wajib https + memuat `{payload}` | `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data={payload}` |
| `TELEGRAM_BOT_TOKEN` | 🔒🖥 | — (kosong = notifikasi skip) | Dari @BotFather (`/newbot`) | `123456789:AAExampleTokenFormatNotReal123` |
| `TELEGRAM_CHAT_ID` | 🖥 | — (berpasangan dengan token) | Chat ID penjual (lihat `docs/telegram.md`) | `987654321` atau `-1001234567890` (grup) |

> **Kombinasi metode pembayaran.** Toko butuh minimal SATU metode aktif:
> pembayaran manual (gambar QR diunggah via `/admin/settings` +
> `MANUAL_PAYMENT_ENABLED=true`) atau QRIS otomatis (kedua var YoBasePay terisi).
> Bila dua-duanya mati, `/checkout` menampilkan "Pembayaran belum tersedia"
> (bukan error). Detail: `docs/manual-payment.md`.

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
