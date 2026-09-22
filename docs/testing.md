# Test Checklist (jalankan sebelum & sesudah deploy)

Legenda: [AUTO] unit test (`npm test`) · [MANUAL] lewat browser/Telegram.
Tandai centang di copy-mu. Semua harus ✅ sebelum produksi.

## 0. Pra-syarat
- [ ] `npm run typecheck`, `npm run build`, `npm test` hijau (18 file / 214 test)
- [ ] 2 Supabase terpasang + SQL dijalankan (cek trigger & RLS — lihat docs masing-masing)
- [ ] Supabase #2 sudah menjalankan `002_manual_payment.sql` (kolom `orders.payment_method` ada) **dan** `004_whatsapp_payment.sql` (kolom `manual_payment_settings.whatsapp_number` ada) — bila tidak, `/admin` menampilkan banner migrasi
- [ ] Nomor WhatsApp penjual sudah diisi di `/admin/settings` (atau `WHATSAPP_SELLER_NUMBER`)
- [ ] [AUTO] Database tanpa kolom pembayaran manual tidak menjatuhkan `/admin` (`test/schema-gap-admin.test.ts`)
- [ ] [AUTO] Database belum `002`/`004` → checkout 503 (bukan 500), admin tetap bisa dibuka, order arsip YoBasePay/Stenly tetap terbaca (`test/schema-gap-admin.test.ts`)
- [ ] [AUTO] SQL migrasi di banner `/admin` setara file `004_whatsapp_payment.sql` (`test/schema-migration.test.ts`)
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
- [ ] [MANUAL] Create: order PENDING + `ORD-YYYYMMDD-XXXXXX`, `payment_method='MANUAL'`, `charged_amount = total + kode unik 1..999`, `payment_id`/`payment_url`/`qr_image_url` NULL; buyer tak terlihat UUID mentah
- [ ] [MANUAL] Checkout **tidak** menawarkan pilihan metode (hanya satu metode) — dan tab lama yang masih mengirim `paymentMethod` tetap membuat order `MANUAL`
- [ ] [MANUAL] Kepemilikan: buyer A akses `/orders/{kode milik B}` → 404; API `/api/orders/{B}` → 404
- [ ] [MANUAL] Transisi admin: PAID→Proses→Selesai; tombol hilang saat tidak relevan; API PATCH action salah → 409
- [ ] [MANUAL] Admin access: buyer buka /admin/* → redirect; API admin → 403
- [ ] [AUTO] order-code format & charset anti-karakter-tukar
- [ ] [MANUAL] Quantity 0/99/abc/UUID palsu → ditolak 400, tidak ada order yatim
- [ ] [MANUAL] Belum ada nomor WA penjual → checkout menolak 503 "penjual belum mengatur nomor WhatsApp", **tidak ada** baris order baru

## 4. PEMBAYARAN MANUAL VIA WHATSAPP

### Setup & status
- [ ] [AUTO] `manualSettingsSchema`: `whatsapp_number` wajib, nomor dinormalisasi (`0812…`, `+62 812…` → `62812…`), label/expiry/template dibatasi (`test/validation-helpers.test.ts`)
- [ ] [MANUAL] `/admin/settings` → isi nomor WA → Simpan → panel status berubah jadi siap; nomor salah (`12345`) ditolak dengan pesan jelas
- [ ] [MANUAL] Kosongkan nomor → panel status `no_whatsapp` + checkout menolak 503; matikan saklar → `disabled`
- [ ] [MANUAL] DB belum dimigrasi 004 → status `schema_missing` + banner memuat SQL `004_whatsapp_payment.sql`
- [ ] [MANUAL] Nomor dari DB menang atas `WHATSAPP_SELLER_NUMBER`; kosongkan DB → env dipakai (panel menyebut sumber nomor)
- [ ] [MANUAL] Ganti nomor → halaman `/pay/…` dan tombol WhatsApp memakai nomor baru **tanpa deploy ulang**

### Chat & pembayaran
- [ ] [MANUAL] `/pay/[code]` hanya menampilkan tombol **💬 Buka WhatsApp Penjual** — **tidak ada** gambar QR maupun nomor rekening di halaman
- [ ] [MANUAL] Link `wa.me/<nomor>?text=…` terisi kode order, produk, jumlah, nominal; template dari `/admin/settings` dipakai apa adanya (`{kode}` `{total}` dst. diganti)
- [ ] [AUTO] `renderPaymentMessage` / `paymentWhatsappUrl` / `transferProofMessage` (template default, placeholder tak dikenal dibiarkan, nomor dibersihkan, pesan ter-encode) — `test/whatsapp.test.ts`
- [ ] [MANUAL] Nominal di halaman = `total + kode unik` (mis. Rp50.417); kode unik konsisten tiap halaman dibuka
- [ ] [AUTO] `manualUniqueCode` (rentang 1..999, deterministik, sebaran wajar) + `manualChargedAmount` + `manualAmountAcceptable`

### Klaim buyer
- [ ] [MANUAL] Tombol "Saya sudah transfer" → `manual_claim_at/note/reference` terisi; status **TETAP PENDING**; tombol tidak bisa dipakai dua kali
- [ ] [AUTO] Klaim tidak melunaskan order; klaim kedua no-op; notifikasi Telegram sekali (`test/manual-payment-flow.test.ts`)
- [ ] [AUTO] Klaim order arsip (`STENLY`/`YOBASEPAY`), order PAID, dan order EXPIRED → 409
- [ ] [MANUAL] Telegram: **🧾 KLAIM TRANSFER MANUAL** sekali per klaim (`manual_claim_notified_at`)

### Verifikasi penjual
- [ ] [MANUAL] `/admin` kartu **Perlu verifikasi** = 1; `/admin/orders?status=CLAIM` menampilkan order itu (klaim tertua dulu)
- [ ] [AUTO] Konfirmasi penjual → PAID + `manual_review_status=APPROVED` + Telegram "🔔 PESANAN BARU"; konfirmasi 2× → 409
- [ ] [MANUAL] Konfirmasi dengan **nominal masuk < total** → ditolak 409, order tetap PENDING
- [ ] [MANUAL] Nominal masuk pas/sesuai → tersimpan di `charged_amount`, order PAID, halaman buyer ✅ dalam ≤8 dtk
- [ ] [MANUAL] **Tolak klaim** → `manual_review_status=REJECTED`, klaim dibersihkan, alasan tampil ke buyer, buyer boleh klaim ulang
- [ ] [AUTO] `adminRejectManualClaim` membersihkan jejak + tidak memakai filter `is.` untuk kolom teks (regresi 22P02)
- [ ] [AUTO] Order `MANUAL` yang sudah diklaim TIDAK di-expire otomatis; yang belum diklaim → EXPIRED setelah `payment_expired_at` + grasi

### Kadaluarsa
- [ ] [MANUAL] Order baru tanpa klaim → lewat `payment_expired_at` (uji dengan `expiry_minutes=10`) → `EXPIRED` + pesan jujur di `/pay/…`
- [ ] [MANUAL] Order **tanpa klaim** (buyer transfer langsung dari chat) → detail order di `/admin` tetap punya **✓ Konfirmasi Pembayaran Lunas**; begitu dikonfirmasi order jadi `PAID`
- [ ] [MANUAL] Order `EXPIRED` yang uangnya telanjur masuk → **✓ Konfirmasi Pembayaran Lunas** di detail order → kembali `PAID`
- [ ] [MANUAL] Order yang sudah diklaim → tetap PENDING walau lewat batas waktu
- [ ] [MANUAL] Admin **✕ Expire** pada order PENDING → EXPIRED (tidak ada transisi balik)
- [ ] [MANUAL] Order arsip QRIS otomatis tampil dengan label **"QRIS Otomatis (lama)"** dan tidak bisa dikonfirmasi lewat jalur manual

## 5. TELEGRAM
- [ ] [MANUAL] Notifikasi masuk saat order PAID — format sesuai spec (kode, buyer, WA, produk, jumlah, total, metode, LUNAS ✅)
- [ ] [MANUAL] Token sengaja salah → order TETAP PAID, `telegram_send_*` di log, user tidak melihat error
- [ ] [MANUAL] Duplicate prevention — `telegram_notified_at` / `manual_claim_notified_at` terisi
- [ ] [AUTO] `formatPaidMessage` & `formatManualClaimMessage` field lengkap (label "Transfer Manual (WhatsApp)" / "QRIS Otomatis (lama)")
- [ ] [MANUAL] Env Telegram kosong → sistem jalan (skip + log `telegram_disabled_skip_notify`)

## 6. SECURITY
- [ ] [MANUAL] Buyer → `/admin/orders`, `/api/admin/products` (login buyer) → 403/redirect
- [ ] [MANUAL] Buyer → PATCH profil `role=admin` → ditolak (trigger; cek pesan error DB = "Mengubah role tidak diizinkan")
- [ ] [MANUAL] Buyer → order orang lain (list & API) → tidak terlihat
- [ ] [MANUAL] Buyer → mencoba melunasi ordernya sendiri: tidak ada endpoint/aksi yang bisa dipakai (klaim hanya antrian)
- [ ] [MANUAL] Buyer → ubah harga via request produk → tidak ada endpoint; RLS #2 menolak anon UPDATE
- [ ] [MANUAL] Endpoint lama benar-benar hilang: `GET /api/manual-qr`, `POST /api/webhooks/stenly`, `GET /api/admin/payments/diagnose` → 404
- [ ] [MANUAL] Secrets tidak di bundle: `npm run build` lalu
      `grep -R "service_role\|sk_live_\|whsec_" .next/static || echo BERSIH`
- [ ] [MANUAL] REST anon key Supabase #2: `GET /rest/v1/orders` → 401/[]
- [ ] [MANUAL] `git log -p --all -S "sb_secret"` → tidak ada nilai asli
- [ ] [MANUAL] Tidak ada env provider di mana pun: `grep -R "STENLY\|NEXT_PUBLIC_STENLY" . --exclude-dir=node_modules --exclude-dir=.git || echo BERSIH`
- [ ] [MANUAL] Header security: cek `security-headers` di `next.config.ts`
- [ ] [MANUAL] Rate limit: 30× polling status cepat dalam 1 mnt → 429; 11 create order → 429; 11 klaim cepat → 429

## 7. UX & PERFORMA
- [ ] [MANUAL] Mobile 375px: semua 14 halaman tampil rapi (home…admin products) tanpa horizontal scroll
- [ ] [MANUAL] Error page (404, order tak ditemukan) ramah, tanpa stack trace
- [ ] [MANUAL] Lighthouse (mobile): Performance ≥ 90, JS First-Load < 150 kB
- [ ] [MANUAL] Katalog cold <500 ms (cache tag), gambar lazy

## 8. PRODUCTION CHECKLIST
- [ ] Semua env produksi final; domain final sinkron di tempat yang relevan (site URL + Supabase redirect)
- [ ] Nomor WhatsApp penjual terisi di `/admin/settings`, template pesan sudah dicek isinya
- [ ] Supabase: autoconfirm OFF, backup/PITR sesuai paket, `anon` & `service_role` baru jika pernah bocor
- [ ] Vercel: domain HTTPS aktif; "Deployment Protection" sesuai kebutuhan tim
- [ ] Cloudflare rate-limit aktif untuk `/auth` & `/api/orders` (lihat cloudflare.md)
- [ ] Test order nyata Rp1.000–10.000 → chat WA → transfer + kode unik → klaim → konfirmasi penjual → Telegram → Selesai → arsipkan; produk dummy dihapus
- [ ] Halaman bantuan buyer (copy dari buyer-guide.md) & WA penjual siap
- [ ] Log Vercel bisa diakses owner; password manager berisi 2×3 keys + bot token
