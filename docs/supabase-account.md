# Supabase #1 — ACCOUNT (Auth + Profil)

Project khusus: register, login, logout, verifikasi email, reset password,
profil buyer + nomor WhatsApp, role admin. **Tidak ada data transaksi di sini.**

## 1. Membuat project

1. https://supabase.com/dashboard → **New project**.
2. Name `anubis-account`, password DB (catat), Region **Singapore** → Create, tunggu provisioning.

## 2. Mengambil credentials

Project Settings (⚙️) → **Data API / API**:

| Yang diambil | Dipakai untuk env |
|---|---|
| Project URL `https://xxxx.supabase.co` | `NEXT_PUBLIC_SUPABASE_ACCOUNT_URL` |
| `anon` / `publishable` key | `NEXT_PUBLIC_SUPABASE_ACCOUNT_ANON_KEY` |
| `service_role` secret | `SUPABASE_ACCOUNT_SERVICE_ROLE_KEY` (server only!) |

## 3. Membuat schema

SQL Editor → New query → paste `supabase/account/001_schema.sql` → Run. Yang dibuat:

- Tabel `profiles` (id FK→auth.users, name, email, whatsapp `^[0-9]{8,15}$`,
  role `buyer|admin`, timestamps, index email).
- `handle_new_user` trigger di `auth.users`: saat user dibuat, baris profil
  terisi dari `raw_user_meta_data` (name, whatsapp yang dikirim form register)
  — jadi API kita tidak perlu menulis profil secara manual.
- `profiles_guard_role_change`: user login yang mencoba `UPDATE role` →
  `raise exception`. Hanya service_role (API server) & SQL editor owner yang bisa.
- RLS aktif; policy: **select own row** + **update own row**. Anon tidak punya
  policy → tidak bisa membaca apapun (email user lain pun tidak).

## 4. Konfigurasi Auth (dashboard → Authentication)

**Sign In / Up → Providers → Email**
- `Confirm email`: **ON** (default). Tanpa ini siapa pun bisa login tanpa verifikasi — requirement kita mewajibkan verifikasi.
- Jangan aktifkan Autoconfirm.

**URL Configuration**
- Site URL: `https://domain-anda.com`
- Redirect URLs (Allow list): `https://domain-anda.com/auth/callback`
- Lokal dev: `http://localhost:3000` + `http://localhost:3000/auth/callback`

**Email Templates** → edit 2 template (isi link, lihat deployment.md §D3):
- Confirm signup → `{{ .SiteURL }}/auth/callback?next=/auth/verify&token_hash={{ .TokenHash }}&type=email`
- Recover password → `{{ .SiteURL }}/auth/callback?next=/auth/reset-password&token_hash={{ .TokenHash }}&type=recovery`

Mengapa begini: `/auth/callback` menerima `token_hash` dan memanggil
`supabase.auth.verifyOtp({ token_hash, type })` — flow resmi Supabase untuk
email link (tanpa token di URL/fragment browser). Link reset & verifikasi
otomatis membuat session httpOnly di domain kita.

**Rate limits** (Authentication → Advanced): default cukup; SMTP sendiri
(SMTP Settings) untuk produksi — gratis 300/hari di Brevo/Resend; tanpa SMTP
sendiri Supabase membatasi ±2 email/jam pada project kecil.

**Password settings**: minimum panjang biarkan 6 (aplikasi mewajibkan 8 via
validasi zod di `src/lib/validation.ts` sebelum memanggil Supabase).

## 5. Testing manual (lakukan!)

1. **Register**: buka `http://localhost:3000/auth/register` (atau live URL),
   buat akun uji → harus muncul "Silakan cek email".
   - SQL Editor → Table Editor → `profiles`: baris baru ada, role `buyer`,
     whatsapp ternormalisasi `62…`. ✅
   - Inbox: email "Confirm your email" masuk; klik tombol → ke
     `/auth/verify?verified=1`. ✅
2. **Login** dengan password → masuk beranda; cookie session (`sb-<ref>-auth-token`)
   terlihat di DevTools → Application → Cookies (httpOnly ✅).
3. **Belum verifikasi**: akun kedua, jangan klik link → login ditolak
   "Email not confirmed" → diarahkan ke `/auth/verify?unverified=1`;
   coba checkout → tetap ditolak (server yang ngecek, bukan frontend). ✅
4. **Resend**: di `/auth/verify` klik kirim ulang → email kedua datang. ✅
5. **Reset password**: `/auth/forgot-password` → email → link → set password
   baru → auto-logout → login dengan password baru. ✅
6. **RLS test** (SQL Editor):
   ```sql
   -- anon tidak boleh bisa baca profiles (simulasi: query via REST tanpa key)
   ```
   ```bash
   curl "https://<ref>.supabase.co/rest/v1/profiles?select=*" -H "apikey: <ANON_KEY>"
   # → 401/[] (bukan daftar user) ✅
   ```

## 6. Membuat akun admin pertama

Lihat `docs/deployment.md` §D5. Intinya: Users → Add user (+ mark email
confirmed) → `update profiles set role='admin' where email='…'` di SQL editor.
Penetapan role **hanya** bisa lewat dashboard/SQL/service-role — tidak ada email
hardcode di source code.

## 7. Yang TIDAK boleh dilakukan di project ini

- Menyimpan produk/order/transaksi (itu tugas project #2).
- Menonaktifkan RLS, menambah policy `anon` untuk `profiles`.
- Memberi tahu siapa pun `service_role` key.
