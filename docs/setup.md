# Setup Local (dari nol)

Untuk developer pemula. Target: situs jalan di `http://localhost:3000`.

## 0. Yang harus terpasang

- **Node.js 20+** (disarankan 22 LTS) — cek: `node -v`
- **npm** (bawaan Node) — cek: `npm -v`
- Git
- Browser untuk mencoba

> Tidak perlu Docker, database lokal, atau VPS.

## 1. Clone & install

```bash
git clone <repo-url> && cd anubis
npm install
```

## 2. Buat 2 project Supabase (5 menit)

Lakukan dulu supaya punya URL + keys (di **dashboard** https://supabase.com):

1. Sign up/login → **New project** → nama: `anubis-account`, region Singapore → Create
   (tunggu provision, **copy Project ID/URL & keys** lewat ⚙️ Project Settings → API).
2. Ulangi → nama: `anubis-store`.
3. Di masing-masing project: **SQL Editor → New query** → paste isi file:
   - Supabase #1 (account) ← `supabase/account/001_schema.sql` → Run
   - Supabase #2 (store) ← `supabase/store/001_schema.sql` → Run
   - Supabase #2 (store) ← `supabase/store/002_manual_payment.sql` → Run
     (migrasi pembayaran manual; idempoten)
   - Supabase #2 (store) ← `supabase/store/004_whatsapp_payment.sql` → Run
     (migrasi nomor WhatsApp penjual; idempoten. **Wajib** bila project #2 sudah
     pernah menjalankan `001_schema.sql` versi lama — tanpa itu aplikasi gagal
     dengan `column orders.payment_method does not exist` /
     `column manual_payment_settings.whatsapp_number does not exist`, lihat
     `docs/troubleshooting.md` §18.)
   (Penjelasan detail, konfigurasi Auth & email: `docs/supabase-account.md`,
   `docs/supabase-store.md`.)

## 3. Konfigurasi environment

```bash
cp .env.example .env.local
```

Isi `.env.local` dengan nilai asli dari Supabase dashboard (lihat
`docs/environment-variables.md` untuk arti & lokasi tiap variabel).

Yang **wajib** hanya kredensial Supabase (URL + keys kedua project): app
sengaja **fail-fast** bila salah satu belum diisi. `TELEGRAM_*` boleh dibiarkan
kosong.

> **Satu-satunya metode bayar = transfer manual via WhatsApp.** Tidak ada
> kredensial provider yang perlu diisi. Agar checkout bisa membuat order, ada
> dua hal yang harus siap:
> 1. `MANUAL_PAYMENT_ENABLED` tidak diset `false` (default `true`), **dan**
> 2. **nomor WhatsApp penjual** terisi — buka `/admin/settings` → isi nomor →
>    Simpan. Untuk bootstrap sebelum sempat login ke `/admin`, boleh pakai
>    cadangan env `WHATSAPP_SELLER_NUMBER`.
>
> Tanpa nomor itu metode dianggap belum siap dan checkout menampilkan
> "Pembayaran belum tersedia". Panduan lengkap: `docs/manual-payment.md`.
>
> Env *preferensi* (`MANUAL_PAYMENT_ENABLED`, `WHATSAPP_SELLER_NUMBER`) toleran
> salah ketik — nilai tak dikenal tidak menjatuhkan situs. Yang tetap fail-fast
> hanya kredensial. Var provider lama (`STENLY_*`, `DEFAULT_PAYMENT_METHOD`,
> `MANUAL_PAYMENT_QR_IMAGE_URL`) sudah tidak dibaca kode.

> `.env.local` tidak akan pernah ter-commit (ada di `.gitignore`).

## 4. Jalankan

```bash
npm run dev        # http://localhost:3000
```

Cek cepat:
- `/` terbuka, header "Toko Saya" muncul ✅
- `/auth/register` menampilkan form + peringatan nomor WA ✅
- Terminal bersih dari error `Konfigurasi environment tidak valid` ✅

## 5. Quality gate (jalankan sebelum deploy)

```bash
npm run typecheck   # TypeScript strict
npm test            # unit test logic kritis (uang, nomor WA, alur pembayaran manual)
npm run build       # build produksi
```

## 6. Coba alur penuh

Ikuti checklist di **`docs/testing.md`** (auth → produk → order → chat WhatsApp
→ klaim transfer → verifikasi penjual → admin).

Uji pembayaran manual tidak butuh internet tambahan maupun tunnel: cukup buka
`/pay/<kode>` di dua peran (buyer & admin) — tombol WhatsApp memakai link
`wa.me`, jadi kamu bisa memeriksa isi pesannya di aplikasi WhatsApp/WhatsApp Web.
Kalau ingin memaksa alur lengkap tanpa benar-benar transfer, buat order lalu
konfirmasi sebagai penjual dari `/admin/orders?status=CLAIM` (catatan
verifikasi diisi alasan uji).

## Troubleshooting awal

| Gejala | Kemungkinan | Solusi |
|---|---|---|
| `Konfigurasi environment tidak valid` saat dev | `.env.local` belum ada/lengkap | Lihat pesan — nama var disebut; isi semua var wajib |
| `ERR_MODULE_NOT_FOUND` | npm install gagal | `rm -rf node_modules && npm install` |
| Port 3000 dipakai | app lain jalan | `npm run dev -- -p 3001` (update `NEXT_PUBLIC_SITE_URL`) |
| Halaman error Supabase `invalid api key`/`JWT expired` | key ketuker antara project #1 dan #2 | Pastikan URL+key sepasang dari project yang sama |
| Checkout bilang "Pembayaran belum tersedia" | `WHATSAPP_SELLER_NUMBER` kosong & nomor belum diisi di `/admin/settings` | Isi salah satu (lihat `docs/manual-payment.md`) |
| Banner merah "Database toko belum dimigrasi" di `/admin` | migrasi 002/004 belum dijalankan di Supabase #2 | Jalankan SQL dari banner (aman berulang) |
| Login "Invalid login credentials" padahal baru daftar | email belum diverifikasi / Autoconfirm aktif | Lihat `docs/supabase-account.md` §4-5 |

Lengkapnya: `docs/troubleshooting.md`.
