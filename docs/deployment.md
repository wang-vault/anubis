# Deployment ke Produksi — Langkah A–O

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
   `manual_payment_settings`). Idempoten, dan **wajib** untuk project yang
   sudah menjalankan `001_schema.sql` versi lama.

> Melewatkan langkah 3 adalah penyebab error produksi
> `column orders.payment_method does not exist` — dashboard `/admin` lalu
> menolak menampilkan order. Lihat `docs/troubleshooting.md` §18.

✅ Tanda berhasil:
- #1 → **Table Editor** muncul tabel `profiles`; di **Database → Triggers** ada
  `on_auth_user_created`, `profiles_guard_role_change`, `profiles_set_updated_at`.
- #2 → tabel `products`, `orders`, `manual_payment_settings`; di
  **Auth → Policies (RLS)** semuanya "Restricted" — products hanya SELECT
  publik, orders & manual_payment_settings tanpa policy (deny-all).
  Kolom `orders.payment_method` ada (cek di Table Editor).
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
   (D1) + Domain lock YoBasePay + webhook URL (J) ke domain baru → **Redeploy** di Vercel.

✅ `https://tokoanda.com` hijau di Vercel (SSL otomatis).

## I. Konfigurasi YoBasePay (akun & API key) — OPSIONAL

> **Lewati bagian I & J bila kamu memakai mode "manual saja".**
> Biarkan `YOBASEPAY_API_KEY` & `YOBASEPAY_WEBHOOK_SECRET` kosong: integrasi
> QRIS Otomatis mati (webhook ditolak, order QRIS via API balas 409), opsi
> "QRIS Otomatis" di checkout tetap tampil namun ber-badge **"Ongoing"** dan
> tidak bisa dipilih, dan toko berjalan penuh dengan **Transfer Manual**. Yang
> wajib dilakukan hanya **upload gambar QR di `/admin/settings`** (lihat §I-alt
> di bawah). Setelah kedua var itu diisi + redeploy, opsi QRIS Otomatis
> otomatis bisa dipilih buyer di halaman checkout.

Ikuti **`docs/yobasepay.md`** bagian 1–4 (registrasi, buat project, API key,
domain lock, saldo/aktif). Setelah credential masuk Vercel → **Redeploy**.

### I-alt. Mode "manual saja" (tanpa provider)

1. Login `/admin/login` → menu **Pembayaran** (`/admin/settings`).
2. Pastikan **"Aktifkan metode pembayaran manual"** tercentang.
3. **Upload gambar QR statis** kamu (QR GoPay Merchant / QRIS bank; PNG/JPG/WebP).
4. Isi *Nama penerima* & *Batas waktu bayar* → **Simpan**.
5. Cek panel **Status saat ini**: "Transfer Manual" harus hijau/"Tampil di
   halaman checkout". Bila tertulis `no_qr`, gambar QR belum tersimpan. Baris
   "QRIS Otomatis (YoBasePay)" berbunyi **ONGOING** — normal pada tahap ini
   (env `YOBASEPAY_*` belum terisi).

✅ Buka `/checkout?product=…` sebagai buyer → "Transfer Manual" terpilih
(default); "QRIS Otomatis" ber-badge **"Ongoing"** dan tidak bisa dipilih
selama env `YOBASEPAY_*` belum terisi (bisa dipilih setelah env terisi +
redeploy).

> Tanpa langkah 3, checkout menampilkan **"Pembayaran belum tersedia"** karena
> tidak ada satu pun metode yang siap.

Uji cepat create-payment dari server (bukan browser!):
```bash
# jalan di laptop, nilai dari env Vercel tidak perlu — cukup key-nya
curl "https://yobasepay.net/api?action=createpayment&apikey=<API_KEY>&amount=10000"
# sukses: {"status":true,"data":{"trx_id":"YO-…","payment_url":"…","qr_image":"…","expired_at":"…"}}
```

## J. Konfigurasi webhook YoBasePay

- URL tujuan: `https://tokoanda.com/api/webhooks/yobasepay`
- Secret: salin ke `YOBASEPAY_WEBHOOK_SECRET` → Redeploy.
- Test: bayar transaksi kecil (lihat `docs/yobasepay.md` §6 untuk resep curl +
  cara baca log). ✅ = order di Supabase #2 menjadi `payment_status=PAID`.

## K–M. Telegram Bot (notifikasi penjual)

Ikuti **`docs/telegram.md`** dari nol: buat bot @BotFather → token → chat ID →
isi `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` → Redeploy → tes kirim pesan →
tes order lunas memunculkan pesan.

## N. Test end-to-end

Jalankan checklist **`docs/testing.md`** minimal alur:
register buyer → verif email → tambah produk (admin) → checkout → QRIS bayar
→ PAID + Telegram → Proses → WhatsApp → Selesai.

## O. Production checklist (habiskan! 15 menit)

- [ ] Repo privat / tidak ada `.env` ter-commit (`git log -p --all -S service_role`)
- [ ] Semua env terisi & **Redeploy** setelah perubahan apa pun
- [ ] Supabase: Autoconfirm **OFF**, SMTP dikirim sendiri, backup harian aktif (Settings → Database → Pitr)
- [ ] Domain final = `NEXT_PUBLIC_SITE_URL` = Supabase Site URL (+ bila pakai YoBasePay: = Domain lock = webhook URL)
- [ ] Akun admin tes sudah login `/admin/login`
- [ ] Produk nyata dibuat; produk dummy tidak ada (memang tidak pernah dibuat)
- [ ] **Minimal satu metode bayar siap** — cek `/admin/settings` → panel "Status saat ini":
  - mode manual saja → "Transfer Manual" tampil di checkout (QR sudah di-upload);
    "QRIS Otomatis" ber-badge ONGOING — itu disengaja
  - mode QRIS otomatis → webhook live **dan** opsi "QRIS Otomatis" bisa
    dipilih buyer di halaman checkout (badge "Ongoing" hilang). Uji lewat UI
    checkout atau `POST /api/orders {"paymentMethod":"YOBASEPAY"}` (lihat
    `docs/yobasepay.md` §5)
- [ ] Telegram tes masuk saat PAID
- [ ] Rate limit Cloudflare aktif (opsional disarankan — `docs/cloudflare.md`)
- [ ] Nominal transfer unik buyer terverifikasi oleh tolerance check (cek log 1x)

Selesai — sistem siap dikelola manual dari dashboard (lihat `docs/admin-guide.md`).
