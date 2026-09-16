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
     (migrasi pembayaran manual; idempoten. **Wajib** bila project #2 sudah
     pernah menjalankan `001_schema.sql` versi lama — tanpa itu aplikasi gagal
     dengan `column orders.payment_method does not exist`, lihat
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
sengaja **fail-fast** bila salah satu belum diisi. `YOBASEPAY_*` dan
`TELEGRAM_*` boleh dibiarkan kosong.

> **Default file ini = mode "manual saja".** Dengan `YOBASEPAY_API_KEY` &
> `YOBASEPAY_WEBHOOK_SECRET` kosong, integrasi QRIS Otomatis nonaktif — di
> halaman checkout opsinya tetap tampil namun ber-badge **"Ongoing"** (tidak
> bisa dipilih), dan toko berjalan penuh memakai **Transfer Manual** (QRIS
> statis milikmu). Checkout **tidak** menunggu YoBasePay. Begitu kedua var
> terisi + redeploy, opsi QRIS Otomatis otomatis ikut bisa dipilih buyer
> (badge "Ongoing"-nya hilang).
>
> Syaratnya satu: **upload gambar QR di `/admin/settings`**. Tanpa QR itu
> metode manual dianggap belum siap dan checkout menampilkan "Pembayaran
> belum tersedia". Panduan lengkap: `docs/manual-payment.md`.
>
> Env *preferensi* (`DEFAULT_PAYMENT_METHOD`, `MANUAL_PAYMENT_ENABLED`)
> toleran salah ketik — nilai tak dikenal jatuh ke default aman, tidak
> menjatuhkan situs. Yang tetap fail-fast hanya kredensial.

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
npm test            # unit test logic kritis (uang, nomor WA, webhook amount)
npm run build       # build produksi
```

## 6. Coba alur penuh

Ikuti checklist di **`docs/testing.md`** (auth → produk → order → bayar →
webhook test → admin). Untuk menguji pembayaran QRIS asli diperlukan akun
YoBasePay (lihat `docs/yobasepay.md`) dan untuk webhook dari internet kamu perlu
URL publik — dev lokal tidak menerima webhook; gunakan tunnel (opsional:
`npx ngrok http 3000` + daftarkan URL ngrok sebagai webhook sementara) atau
test webhook dengan curl bertanda tangan (resep ada di `docs/yobasepay.md` §6).

## Troubleshooting awal

| Gejala | Kemungkinan | Solusi |
|---|---|---|
| `Konfigurasi environment tidak valid` saat dev | `.env.local` belum ada/lengkap | Lihat pesan — nama var disebut; isi semua var wajib |
| `ERR_MODULE_NOT_FOUND` | npm install gagal | `rm -rf node_modules && npm install` |
| Port 3000 dipakai | app lain jalan | `npm run dev -- -p 3001` (update `NEXT_PUBLIC_SITE_URL`) |
| Halaman error Supabase `invalid api key`/`JWT expired` | key ketuker antara project #1 dan #2 | Pastikan URL+key sepasang dari project yang sama |
| Login "Invalid login credentials" padahal baru daftar | email belum diverifikasi / Autoconfirm aktif | Lihat `docs/supabase-account.md` §4-5 |

Lengkapnya: `docs/troubleshooting.md`.
