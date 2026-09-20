# Test Checklist (jalankan sebelum & sesudah deploy)

Legenda: [AUTO] unit test (`npm test`) · [MANUAL] lewat browser/Telegram.
Tandai centang di copy-mu. Semua harus ✅ sebelum produksi.

## 0. Pra-syarat
- [ ] `npm run typecheck`, `npm run build`, `npm test` hijau
- [ ] 2 Supabase terpasang + SQL dijalankan (cek trigger & RLS — lihat docs masing-masing)
- [ ] Supabase #2 sudah menjalankan `002_manual_payment.sql` (kolom `orders.payment_method` ada — bila tidak, `/admin` menampilkan banner migrasi)
- [ ] Supabase #2 sudah menjalankan `003_stenly_payment.sql` (CHECK `payment_method` menerima `'STENLY'` — bila tidak, checkout QRIS otomatis membalas 503 + banner migrasi di `/admin`)
- [ ] [AUTO] Database tanpa kolom pembayaran manual tidak menjatuhkan `/admin` (`test/schema-gap-admin.test.ts`)
- [ ] [AUTO] Database tanpa migrasi Stenly → checkout QRIS 503 (bukan 500), Transfer Manual tetap jalan, order YoBasePay lama tetap terbaca (`test/schema-gap-admin.test.ts`)
- [ ] Env Vercel lengkap + sudah redeploy setelah perubahan

## 1. AUTH
- [ ] [MANUAL] Register buyer baru → muncul "cek email" → baris `profiles` terisi (name, whatsapp `62…`, role buyer)
- [ ] [MANUAL] Email verifikasi masuk → klik → `/auth/verify?verified=1` → session aktif
- [ ] [MANUAL] Login sebelum verifikasi → ditolak & diarahkan ke halaman verifikasi
- [ ] [MANUAL] Checkout sebelum verifikasi → ditolak server (403, bukan cuma UI)
- [ ] [MANUAL] Login/logout; password salah → "Email atau password salah." (tanpa info user)
- [ ] [MANUAL] Reset password via email → ganti → auto-logout → login password baru
- [ ] [MANUAL] Register email sudah terdaftar → respons tetap "cek email" (anti-enumeration, tidak ada error bocor)
- [ ] [AUTO] Sanitasi `?next=` (open redirect `//evil.com` ditolak)

## 2. PRODUCT
- [ ] [MANUAL] Admin tambah produk → langsung tampil di katalog (tag revalidasi bekerja)
- [ ] [MANUAL] Edit harga → order lama tidak berubah (cek snapshot `unit_price_snapshot`)
- [ ] [MANUAL] Nonaktifkan produk → hilang dari katalog; `/products/{id}` tampil "Tidak tersedia"; checkout produk tsb ditolak
- [ ] [MANUAL] Buyer view: list, detail, harga format Rp (integer DB)
- [ ] [MANUAL] Input produk invalid (harga <1000, teks kepanjangan) → ditolak dengan pesan jelas

## 3. ORDER
- [ ] [MANUAL] Create: order PENDING + `ORD-YYYYMMDD-XXXXXX`; `payment_id` terisi (= `order_code`, itulah `order_id` di Stenly); buyer tak terlihat UUID mentah
- [ ] [MANUAL] Kepemilikan: buyer A akses `/orders/{kode milik B}` → 404; API `/api/orders/{B}` → 404
- [ ] [MANUAL] Transisi admin: PAID→Proses→Selesai; tombol hilang saat tidak relevan; API PATCH action salah → 409
- [ ] [MANUAL] Admin access: buyer buka /admin/* → redirect; API admin → 403
- [ ] [AUTO] order-code format & charset anti-karakter-tukar
- [ ] [MANUAL] Quantity 0/99/abc/UUID palsu → ditolak 400, tidak ada order yatim

## 4. PAYMENT
- [ ] [AUTO] Adapter Stenly: bentuk request `POST /api/v1/charge` + header `x-api-key`, batas nominal 1.000–10.000.000, `checkStatus` + pemetaan status, verifikasi HMAC, normalisasi webhook (`test/stenly-adapter.test.ts`)
- [ ] [AUTO] Alur pembayaran Stenly end-to-end: create → webhook PAID → signature salah 403 → nominal salah → webhook dobel → expired → polling cadangan (`test/stenly-payment-flow.test.ts`)
- [ ] [MANUAL] Order QRIS via `POST /api/orders {"paymentMethod":"STENLY"}`
      (bila env terisi, opsi "QRIS Otomatis" juga bisa dipilih langsung di
      halaman checkout) →
      menghasilkan QRIS (qr_image + payment_url) + countdown dari `payment_expired_at`
- [ ] [MANUAL] `qr_image_url` yang tersimpan berupa **data URI** hasil render lokal — **tidak** mengandung `api_key`:
      `select qr_image_url from orders order by created_at desc limit 1;` → diawali `data:image/png;base64,`
- [ ] [MANUAL] Signature webhook salah → **403** `INVALID_SIGNATURE`, order tetap PENDING (resep curl: `docs/stenly.md` §7.3)
- [ ] [MANUAL] Webhook nominal ≠ total → order **tetap PENDING** (log `webhook_amount_mismatch`)
- [ ] [MANUAL] Webhook dobel (kirim request identik 2×) → keduanya 200, Telegram **hanya sekali**
- [ ] [MANUAL] Sandbox: key `sk_test_…` + `POST /api/v1/simulate-pay` → order PAID; `/admin/settings` menandai mode sandbox
- [ ] [MANUAL] Pembayaran sukses (scan) → webhook → order PAID otomatis; halaman berubah ✅ tanpa refresh manual
- [ ] [MANUAL] Pembayaran gagal/ batal tidak mengubah order (tetap PENDING sampai expired)
- [ ] [MANUAL] Tidak bayar → kadaluarsa → ❌ + tombol buat order baru; DB `payment_status=EXPIRED`
- [ ] [MANUAL] **Duplicate webhook**: kirim curl test 2× → lunas sekali, `already_processed`, Telegram satu pesan
- [ ] [MANUAL] **Invalid signature**: ubah 1 char → 403, tidak ada perubahan apa pun di DB
- [ ] [MANUAL] **Wrong amount**: ubah amount ±toleransi di body bertanda tangan → `ignored/amount_mismatch`, order tetap PENDING
- [ ] [MANUAL] Frontend tidak bisa memalsukan: POST/GET mencoba set `payment_status` → field diabaikan (cek kode + coba)
- [ ] [MANUAL] Tombol admin "Cek Pembayaran" (tanpa webhook) → PAID via checkstatus provider
- [ ] [AUTO] `amountWithinTolerance` (pas, +kodeunik, di bawah, di atas, tolerance=0, NaN)

## 4b. PEMBAYARAN MANUAL (QRIS statis penjual)
- [ ] [MANUAL] `/admin/settings` → unggah QR (PNG) → Simpan → pratinjau muncul; file > 900 KB / tipe salah → ditolak dengan pesan jelas
- [ ] [MANUAL] `GET /api/manual-qr` → 200 `image/png`; sebelum upload → 404 teks
- [ ] [MANUAL] Checkout SELALU menampilkan dua opsi dengan "Transfer Manual" pertama & terpilih. Env Stenly **kosong** → "QRIS Otomatis" non-aktif ber-badge **"Ongoing"**, klik pada opsi disabled terblokir, tombol submit berbunyi "(Transfer Manual)", `/admin/settings` menyebut QRIS **ONGOING**. Env Stenly **terisi** → kedua opsi bisa dipilih, ganti pilihan mengubah tombol jadi "(QRIS Otomatis)" dan order lahir dengan `payment_method=STENLY` + QR dari provider. Tidak ada metode siap → "Pembayaran belum tersedia" (bukan error)
- [ ] [MANUAL] Order manual: `payment_method=MANUAL`, `charged_amount = total + kode unik (1..999)`, `payment_expired_at` sesuai `expiry_minutes`, `payment_id` NULL
- [ ] [MANUAL] Halaman `/pay/[code]`: QR tampil, nominal = `charged_amount`, tombol **Salin nominal** bekerja, countdown jalan
- [ ] [AUTO] **Klaim buyer tidak bisa melunaskan order** (`claimManualPayment`): klaim dicatat, `payment_status` tetap PENDING, klaim kedua no-op, notifikasi sekali
- [ ] [AUTO] **Hanya penjual yang bisa melunaskan** (`adminConfirmManualPayment`): → PAID + `APPROVED`; konfirmasi 2× ditolak; nominal masuk < total ditolak 409
- [ ] [AUTO] `adminRejectManualClaim` membersihkan klaim + buyer boleh klaim ulang; `refreshOrderStatus` tidak meng-expire order manual yang sudah diklaim
- [ ] [MANUAL] **Klaim buyer**: tombol "Saya sudah transfer" → `manual_claim_at` terisi; tekan 2× → klaim kedua no-op; order TETAP `PENDING`
- [ ] [MANUAL] Klaim order QRIS otomatis / order sudah lunas → 409 (pesan jelas), status tidak berubah
- [ ] [MANUAL] Telegram: **🧾 KLAIM TRANSFER MANUAL** sekali per klaim (`manual_claim_notified_at`)
- [ ] [MANUAL] **Konfirmasi penjual** → `PAID` + `manual_review_status=APPROVED` + Telegram **🔔 PESANAN BARU**; halaman buyer ✅ dalam ≤8 dtk
- [ ] [MANUAL] Konfirmasi dengan nominal masuk < total → ditolak (409), order tetap PENDING
- [ ] [MANUAL] **Tolak klaim** → `manual_review_status=REJECTED`, klaim dibersihkan, alasan tampil ke buyer, buyer bisa klaim ulang
- [ ] [MANUAL] Order manual yang sudah diklaim TIDAK di-expire otomatis lewat batas waktu; yang belum diklaim → EXPIRED
- [ ] [MANUAL] Webhook Stenly tidak bisa menyentuh order manual (tidak ada `payment_id` yang cocok)
- [ ] [AUTO] `manualUniqueCode` (rentang 1..999, deterministik, beda order beda nominal) + `manualChargedAmount`
- [ ] [AUTO] `formatManualClaimMessage` memuat order, nominal tagihan, referensi, catatan, jam WIB
- [ ] [AUTO] `resolvePaymentMethod` / `getAvailablePaymentMethods` / `getManualPaymentView` (metode tak tersedia → 409/503, QR belum ada → `no_qr`)
- [ ] [AUTO] `getCheckoutPaymentMethods` — manual diurutkan pertama (disabled bila saklar penjual mati); QRIS `disabled` + `isOngoing` + badge `"Ongoing"` hanya saat kredensial belum terisi, dan aktif tanpa badge saat terisi (`test/manual-payment-flow.test.ts`)

> Test otomatis alur manual ada di `test/manual-payment-flow.test.ts` (domain
> logic asli dijalankan terhadap fake Supabase — lihat `test/helpers/fake-store.ts`).

## 5. TELEGRAM
- [ ] [MANUAL] Notifikasi masuk saat order PAID — format sesuai spec (kode, buyer, WA, produk, jumlah, total, LUNAS ✅)
- [ ] [MANUAL] Token sengaja salah → order TETAP PAID, `telegram_send_*` di log, user tidak melihat error
- [ ] [MANUAL] Duplicate prevention (lihat §4) — `telegram_notified_at` terisi
- [ ] [AUTO] `formatPaidMessage` field lengkap
- [ ] [MANUAL] Env Telegram kosong → sistem jalan (skip + log `telegram_disabled_skip_notify`)

## 6. SECURITY
- [ ] [MANUAL] Buyer → `/admin/orders`, `/api/admin/products` (login buyer) → 403/redirect
- [ ] [MANUAL] Buyer → PATCH profil `role=admin` → ditolak (trigger; cek pesan error DB = "Mengubah role tidak diizinkan")
- [ ] [MANUAL] Buyer → order orang lain (list & API) → tidak terlihat
- [ ] [MANUAL] Buyer → ubah harga via request produk → tidak ada endpoint; RLS #2 menolak anon UPDATE
- [ ] [MANUAL] Secrets tidak di bundle: `npm run build` lalu
      `grep -R "service_role\|STENLY_API_KEY\|sk_live_\|whsec_" .next/static || echo BERSIH`
- [ ] [MANUAL] REST anon key Supabase #2: `GET /rest/v1/orders` → 401/[]
- [ ] [MANUAL] `git log -p --all -S "sb_secret"` & `-S "STENLY_API_KEY="` → tidak ada nilai asli
- [ ] [MANUAL] Tidak ada env `NEXT_PUBLIC_STENLY_*` di mana pun: `grep -R "NEXT_PUBLIC_STENLY" . --exclude-dir=node_modules || echo BERSIH`
- [ ] [MANUAL] Header security: cek `security-headers` di `next.config.ts`
- [ ] [MANUAL] Rate limit: 30× polling status cepat dalam 1 mnt → 429; 11 create order → 429

## 7. UX & PERFORMA
- [ ] [MANUAL] Mobile 375px: semua 14 halaman tampil rapi (home…admin products) tanpa horizontal scroll
- [ ] [MANUAL] Error page (404, order tak ditemukan) ramah, tanpa stack trace
- [ ] [MANUAL] Lighthouse (mobile): Performance ≥ 90, JS First-Load < 150 kB
- [ ] [MANUAL] Katalog cold <500 ms (cache tag), gambar lazy

## 8. PRODUCTION CHECKLIST
- [ ] Semua env produksi final; domain final sinkron di 3 tempat (site URL, Supabase redirect, Callback URL project Stenly)
- [ ] Supabase: autoconfirm OFF, backup/PITR sesuai paket, `anon` & `service_role` baru jika pernah bocor
- [ ] Vercel: domain HTTPS aktif; "Deployment Protection" sesuai kebutuhan tim
- [ ] Cloudflare rate-limit aktif untuk `/api/webhooks`, `/auth`, `/api/orders` (lihat cloudflare.md)
- [ ] Test order nyata Rp1.000–10.000 → lunas → Telegram → Selesai → arsipkan; produk dummy dihapus
- [ ] Halaman bantuan buyer (copy dari buyer-guide.md) & WA penjual siap
- [ ] Log Vercel bisa diakses owner; password manager berisi 2×3 keys + bot token
