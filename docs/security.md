# Model Keamanan — penjelasan & checklist

## 1. Prinsip: jangan percaya browser

Semua uang & status hidup di server. Tiga pintu masuk publik: **halaman/SSR**,
**API routes**, **webhook**. Masing-masing punya gerbang sendiri:

| Pintu | Gerbang |
|---|---|
| Halaman `/checkout`, `/orders`, `/pay` | Middleware: ada session → **server action/halaman tetap cek ulang** session + `email_confirmed_at` + kepemilikan |
| `/api/orders*` | `requireVerifiedUser()`: `getUser()` ke Supabase (verifikasi token, bukan decode) + profil |
| `/api/admin*` | `requireAdmin()`: `profiles.role='admin'` dibaca dari DB via service role di SETIAP request — bukan dari frontend, bukan dari email hardcoded |
| `/api/webhooks/stenly` | HMAC-SHA256 raw-body constant-time (`X-Stenly-Signature`) + validasi nominal + idempotensi; JSON di-parse setelah signature sah; body dibatasi 64 KB |

## 2. RLS Supabase (baris pertahanan ke-2, di database)

**#1 `profiles`** — select/update `id = auth.uid()` saja; tanpa policy untuk
anon; trigger `profiles_guard_role_change` menolak user mengubah `role`
(walau RLS lolos, mis. via bug — defense-in-depth).

**#2 `products`** — `SELECT` publik `WHERE is_active`; tidak ada policy tulis
→ INSERT/UPDATE/DELETE dari client = ditolak DB; admin tulis via service role.

**#2 `orders`** — RLS aktif, **nol policy** = deny-all:
```sql
-- bukti:
select * from orders; -- via REST anon/authenticated → 401/empty
```
Implikasi yang disengaja: buyer/admin tidak punya "akses DB langsung" sama
sekali. Cross-project juga berarti token #1 tidak berlaku di #2 → satu-satunya
jalan ke orders adalah server aplikasi (yang sudah memfilter kepemilikan).

## 3. Uang benar (anti manipulasi)

1. Harga order = `products.price` dibaca ulang di server saat create — body
   klien hanya `productId`/`quantity`.
2. `total_amount` dihitung server (int Rupiah × int qty) dan disimpan snapshot.
3. Menuju PAID hanya 3 jalur: webhook terverifikasi; `checkstatus` API privat
   dari server; dan **konfirmasi penjual** untuk order manual
   (`adminConfirmManualPayment` — diverifikasi `requireAdmin` + guard
   `payment_method=MANUAL`). Endpoint klien tidak menerima field status apa
   pun; klaim "saya sudah transfer" dari buyer hanya mencatat
   `manual_claim_at` (antrian verifikasi), bukan melunasi order.
4. Webhook validasi nominal: `total ≤ charged ≤ total + toleransi` (kode unik
   Stenly). Amount absen/salah → diabaikan + log, tidak ada auto-PAID.
   QRIS Stenly menagih nominal persis → toleransi 0 untuk metode otomatis.
5. Update PAID idempoten (`WHERE payment_status IN ('PENDING','EXPIRED')`) →
   replay/dobel = no-op; order tidak "dibayar dua kali"; Telegram sekali
   (`telegram_notified_at` claim-before-send).
6. Kegagalan Telegram/provider **tidak** mengorbankan status uang.

## 4. Kebocoran informasi

- Pesan error user: generik & actionable; detail (provider response, DB
  message, stack) hanya `console` (Vercel logs, bukan respons).
- Login/register/forgot/resend: respons **seragam** — tidak mengungkap apakah
  email terdaftar (anti-enumeration).
- Order publik = `order_code` acak (bukan UUID) — enumeration ID DB tidak
  berguna; endpoint tetap cek kepemilikan (404 untuk order asing).
- Webhook membalas body minimal tanpa data order.

## 5. Rate limiting & edge

- In-memory limiter (login 8/5mnt per email+ip, signup 5/10mnt, order 10/10mnt
  per user, status 30/mnt) — **best-effort** di serverless (per instance).
- Lapisan nyata: Cloudflare WAF/rate-limit untuk `/auth/*`, `/api/orders`,
  `/api/webhooks/stenly` (lihat `docs/cloudflare.md`).
- Timeout 15 dtk ke provider, 6 dtk ke Telegram → thread tidak digantung
  server jahat.

## 6. Secrets hygiene

- Tidak ada secret di source (hanya nama var di `.env.example` placeholder).
- `server-only` import pada semua modul DB/provider → build gagal kalau
  terseret ke bundle browser.
- `.env*` di-gitignore; skrip verifikasi cepat:
  ```bash
  git log -p --all -S 'sb_secret' | head          # kosong = aman
  npm run build && grep -RE "eyJ.+\..+\..+" .next/static | head  # JWT bocor?
  ```
- Vercel env: simpan sebagai Secret (bukan committed `.env`); rotasi bila
  pernah terekspos (BotFather `/revoke`, Supabase API keys, Stenly
  regenerate, ganti webhook secret + redeploy).
- Admin TIDAK pernah menerima service key; anon key hanya sekuat RLS.

## 7. Transport & headers

- HTTPS via Vercel (+Cloudflare proxy opsional). Site URL & redirect Supabase
  harus `https://` di produksi.
- Header: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy` (lihat next.config.ts).
  Cookie session: httpOnly/secure/samesite=lax dikelola `@supabase/ssr`.
- CSP ketat (opsional lanjutan): bisa ditambahkan via middleware/Cloudflare;
  belum dipasang karena inline styles Tailwind/QR image lintas host perlu
  penyesuaian — dokumentasikan sebelum mengaktifkan.

## 8. Audit checklist (berkala)

- [ ] `git log -S secret` bersih · repo privat
- [ ] RLS ON di semua tabel (cek `relrowsecurity`)
- [ ] Tidak ada policy tulis untuk anon/authenticated di #2
- [ ] Trigger role-guard masih ada (DROP oleh iseng = lubang privilege)
- [ ] Akses dashboard Supabase [ ] Email admin login terakhir tercatat; akun tak terpakai dihapus di Supabase Vercel hanya untuk owner; 2FA aktif di keduanya
- [ ] Callback URL Stenly hanya endpoint `/api/webhooks/stenly` (bukan dengan secret lama)
- [ ] Tidak ada env `NEXT_PUBLIC_STENLY_*`; `qr_image_url` yang tersimpan berupa data URI (bukan URL provider yang memuat `api_key`)
- [ ] Backup DB hidup (restore test sekali/kuartal)
- [ ] Dependabot/`npm outdated` dipantau (Next/Supabase JS = jalur auth)
