# Deployment ke Produksi — Langkah A–L

Panduan klik-per-klik. Total ±45–75 menit bila pertama kali. Kerjakan berurutan;
setiap langkah punya "✅ tanda berhasil".

---

## A. Buat Supabase #1 (ACCOUNT)

1. Buka https://supabase.com → **Start your project** → daftar (login GitHub disarankan).
2. Dashboard → **New project**:
   - Name: `anubis-account`
   - Database password: buat kuat, **simpan di password manager** (tidak dipakai aplikasi, tapi tidak bisa diubah sembarangan).
   - Region: **Southeast Asia (Singapore)** — paling dekat dengan user ID.
3. Create → tunggu 1–2 menit (provisioning).
4. Ambil kredensial: kiri bawah **⚙️ Project Settings → Data API (API)**:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_ACCOUNT_URL`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ACCOUNT_ANON_KEY`
   - (tab lain) **service_role secret** → `SUPABASE_ACCOUNT_SERVICE_ROLE_KEY` — jangan pernah dibagikan ke browser/chat.

✅ Tanda berhasil: halaman **Table Editor** bisa dibuka; API docs terbuka di `https://<ref>.supabase.co/rest/v1` (minta auth = normal).

## B. Buat Supabase #2 (STORE)

Sama persis, nama project `anubis-store`. Ambil 3 hal: URL, `anon`, `service_role`.
Biarkan dulu (schema dijalankan di langkah C).

## C. Jalankan SQL schema

1. Supabase #1 → **SQL Editor → New query** → paste **seluruh isi**
   `supabase/account/001_schema.sql` → **Run**.
2. Supabase #2 → **SQL Editor → New query** → paste `supabase/store/001_schema.sql` → **Run**.
3. Supabase #2 → **SQL Editor → New query** → paste
   `supabase/store/002_manual_payment.sql` → **Run** (migrasi pembayaran
   manual: kolom `payment_method` + `manual_*` + tabel
   `manual_payment_settings`). Idempoten.
4. Supabase #2 → **SQL Editor → New query** → paste
   `supabase/store/004_whatsapp_payment.sql` → **Run** (migrasi WhatsApp:
   kolom `whatsapp_number` + `whatsapp_message_template`, default
   `payment_method = 'MANUAL'`, label default versi WhatsApp). Idempoten.

> Melewatkan langkah 3/4 adalah penyebab error produksi
> `column orders.payment_method does not exist` /
> `column manual_payment_settings.whatsapp_number does not exist` — dashboard
> `/admin` lalu menampilkan banner migrasi dan checkout menolak order. Lihat
> `docs/troubleshooting.md` §18.

✅ Tanda berhasil:
- #1 → **Table Editor** muncul tabel `profiles`; di **Database → Triggers** ada
  `on_auth_user_created`, `profiles_guard_role_change`, `profiles_set_updated_at`.
- #2 → tabel `products`, `orders`, `manual_payment_settings`; di
  **Auth → Policies (RLS)** semuanya "Restricted" — products hanya SELECT
  publik, orders & manual_payment_settings tanpa policy (deny-all).
  Kolom `orders.payment_method` + `manual_payment_settings.whatsapp_number`
  ada (cek di Table Editor).
- Cek manual di SQL Editor (project #2):
  ```sql
  select relname, relrowsecurity from pg_class where relname in ('products','orders');
  -- dua-duanya true
  ```

## D. Konfigurasi Auth & email (Supabase #1)

**D1. Site URL & redirect**
Authentication → **URL Configuration**:
- *Site URL*: `https://domain-anda.com` (kalau belum punya domain: `https://nama-app.vercel.app`)
- *Redirect URLs* → Add URL: `https://domain-anda.com/auth/callback`
- *Email template links*: biarkan default (aplikasi menangani `/auth/callback`).

**D2. Wajibkan verifikasi email**
Authentication → **Sign In / Up** → Providers → **Email**:
- Pastikan **Confirm email** aktif (default Supabase = aktif). **Jangan** aktifkan Autoconfirm.
- *Maximum frequency / security* biarkan default.

**D3. Template email** (Authentication → **Email Templates**)
Ganti tombol/link pada template **Confirm signup** dan **Recover password** agar deterministik:

- *Confirm signup* → ubah URL tombol menjadi:
  ```
  {{ .SiteURL }}/auth/callback?next=/auth/verify&token_hash={{ .TokenHash }}&type=email
  ```
- *Recover password* →
  ```
  {{ .SiteURL }}/auth/callback?next=/auth/reset-password&token_hash={{ .TokenHash }}&type=recovery
  ```

(Format ini didukung `verifyOtp` yang dipakai `/auth/callback` — lihat `docs/supabase-account.md` §5.)

**D4. (Opsional tapi disarankan) SMTP sendiri** — Supabase bawaan hanya 2 email/jam
dan kadang masuk spam: Authentication → SMTP → isi server/domain (Brevo, Resend,
Mailgun…). Brevo gratis ±300/hari.

✅ Tanda berhasil (uji): buat user uji (lihat §D5 di bawah) → email masuk →
klik link → browser diarahkan ke `…/auth/verify?verified=1`.

**D5. Buat akun ADMIN pertama (pemilik toko)**
1. Authentication → **Users → Add user** → *Create a new user*: email + password Anda;
   centang **"Automatically mark this user as having confirmed email"** (admin tidak perlu klik link).
2. SQL Editor (#1) jalankan:
   ```sql
   update public.profiles set role = 'admin' where email = 'email-anda@example.com';
   select * from public.profiles where email = 'email-anda@example.com';
   ```
3. Pastikan `role = admin` pada hasil SELECT. Tidak ada akun admin ter-hardcode
   di source — ini satu-satunya cara menetapkan (aman: hanya pemegang akses
   dashboard Supabase yang bisa).

## E. Buat project Vercel

1. Push repo ini ke GitHub (branch kerja → merge ke main Anda).
2. https://vercel.com → Add New… → **Project** → import repo `anubis`.
3. Framework terdeteksi **Next.js** — biarkan default (Build command `npm run build`).

## F. Masukkan environment variables (Vercel)

Project → **Settings → Environment Variables** → tambahkan **semua** dari tabel
`docs/environment-variables.md`, scope **Production + Preview + Development**.
Perhatikan: `NEXT_PUBLIC_*` sama persis ejaannya; secret jangan diberi prefix.
Klik **Save**, lalu **Deploy**.

## G. Deploy pertama

Deployments tab pantau build (~1 menit). ✅ berhasil = status *Ready* dan
`https://<project>.vercel.app` menampilkan beranda toko.

## H. Konfigurasi domain

1. Vercel → Project → **Settings → Domains → Add** (`tokoanda.com`).
   - Domain dicatat di Cloudflare? Vercel akan minta ubah 2 record (A `76.76.21.21`,
     CNAME `cname.vercel-dns.com`). Di dashboard Cloudflare: ubah record → **DNS only**
     (abu-abu) untuk CNAME Vercel, atau proxy oranye + mengikuti instruksi Vercel (dua-duanya jalan; lihat `docs/cloudflare.md`).
   - Tanpa Cloudflare: cukup arahkan sesuai instruksi Vercel (atau pakai nameserver Vercel).
2. Setelah domain aktif: **ganti `NEXT_PUBLIC_SITE_URL`** + Redirect URL Supabase
   (D1) ke domain baru → **Redeploy** di Vercel.

✅ `https://tokoanda.com` hijau di Vercel (SSL otomatis).

## I. Aktifkan pembayaran manual via WhatsApp (WAJIB)

Tidak ada akun provider, API key, atau webhook yang perlu diurus. Yang perlu
dilakukan hanya menghubungkan toko ke nomor WhatsApp penjual:

1. Pastikan `MANUAL_PAYMENT_ENABLED` tidak diset `false` (default `true`).
2. Login `/admin/login` → menu **Pembayaran** (`/admin/settings`).
3. Isi **Nomor WhatsApp penjual** (wajib; `081234567890` atau `+62 812…`).
   Opsional: nama penerima, batas waktu bayar (10–4320 menit, default 120),
   nama metode, instruksi tambahan, dan **template pesan WhatsApp**.
4. **Simpan** → panel **Status saat ini** harus berbunyi siap (tanpa
   `no_whatsapp` / `disabled` / `schema_missing`). Tidak perlu redeploy.

> **Cadangan env**: bila kamu ingin checkout langsung hidup sebelum sempat
> membuka dashboard, isi `WHATSAPP_SELLER_NUMBER` di Vercel. Begitu nomor
> disimpan di `/admin/settings`, nilai DB yang dipakai (env diabaikan).

Detail pembayaran (QRIS statis / nomor rekening / e-wallet) **tidak** diunggah
ke aplikasi — penjual mengirimnya langsung di chat WhatsApp saat buyer menekan
tombol di halaman pembayaran. Jadi kalau detailnya berubah, cukup kirim yang
baru di chat; tidak ada yang perlu diedit di dashboard.

✅ Buka `/checkout?product=…` sebagai buyer → order dibuat → di `/pay/…` muncul
tombol **💬 Buka WhatsApp Penjual** dengan pesan berisi kode order + nominal.
Tidak ada gambar QR maupun nomor rekening di halaman (memang disengaja).

> Tanpa nomor WhatsApp, checkout menampilkan **"Pembayaran belum tersedia"**
> dengan alasan `no_whatsapp`. Panduan lengkap: `docs/manual-payment.md`.

## J. Telegram Bot (notifikasi penjual)

Ikuti **`docs/telegram.md`** dari nol: buat bot @BotFather → token → chat ID →
isi `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` → Redeploy → tes kirim pesan →
tes order lunas memunculkan pesan.

## K. Test end-to-end

Jalankan checklist **`docs/testing.md`** minimal alur:
register buyer → verif email → tambah produk (admin) → checkout → chat WhatsApp
→ transfer + kode unik → klaim "Saya sudah transfer" → konfirmasi penjual
(PAID + Telegram) → Proses → Selesai.

## L. Production checklist (habiskan! 15 menit)

- [ ] Repo privat / tidak ada `.env` ter-commit (`git log -p --all -S service_role`)
- [ ] Semua env terisi & **Redeploy** setelah perubahan apa pun
- [ ] Supabase: Autoconfirm **OFF**, SMTP dikirim sendiri, backup harian aktif (Settings → Database → Pitr)
- [ ] Domain final = `NEXT_PUBLIC_SITE_URL` = Supabase Site URL
- [ ] `supabase/store/002_manual_payment.sql` + `004_whatsapp_payment.sql` sudah dijalankan di Supabase #2 (project lama)
- [ ] Akun admin tes sudah login `/admin/login`
- [ ] Produk nyata dibuat; produk dummy tidak ada (memang tidak pernah dibuat)
- [ ] **Metode bayar siap** — `/admin/settings` → panel "Status saat ini" hijau
      (nomor WhatsApp penjual terisi); `/pay/…` menampilkan tombol WhatsApp
      dengan nominal `total + kode unik`
- [ ] Telegram tes masuk saat klaim transfer & saat order PAID
- [ ] Rate limit Cloudflare aktif (opsional disarankan — `docs/cloudflare.md`)
- [ ] Env provider lama (`STENLY_*`, `DEFAULT_PAYMENT_METHOD`, `MANUAL_PAYMENT_QR_IMAGE_URL`)
      sudah dihapus dari Vercel; webhook lama di dashboard provider dimatikan

Selesai — sistem siap dikelola manual dari dashboard (lihat `docs/admin-guide.md`).
