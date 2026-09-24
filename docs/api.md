# API Reference

Base: `https://<domain>`. Format error seragam:
`{"error":{"code":"<KODE>","message":"<pesan aman untuk user>"}}` —
detail internal hanya ke log (Vercel Runtime Logs).

Kode HTTP yang dipakai: 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
403 EMAIL_NOT_VERIFIED / FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT ·
429 TOO_MANY_REQUESTS · 503 PAYMENT_UNAVAILABLE · 500 INTERNAL_ERROR.

Auth cookie: semua endpoint buyer membaca session Supabase #1 dari httpOnly
cookie (browser mengirim otomatis; dari curl pakai `-b "sb-<ref>-auth-token=…"`).

> **Tidak ada endpoint pembayaran provider.** Toko ini hanya punya satu metode
> bayar: transfer manual via WhatsApp. Endpoint `/api/webhooks/stenly`,
> `/api/manual-qr`, dan `/api/admin/payments/diagnose` sudah **dihapus** —
> permintaan ke sana sekarang 404.

## Orders & Payment (buyer)

### POST /api/orders
Buat order transfer manual.
```jsonc
// request
{ "productId": "uuid", "quantity": 1 }         // quantity 1..20
// 201 response
{ "ok": true,
  "order":   { "order_code":"ORD-20260912-MANU4L","total_amount":50000,
               "order_status":"PENDING","payment_status":"PENDING" },
  "payment": { "expiresAt":"2026-09-12T14:30:00.000Z",   // now + expiry_minutes pengaturan
               "sellerWhatsapp":"628111222333" } }       // siap dipakai tombol wa.me
```
Syarat: login + email verified. Harga dari DB, BUKAN dari request.
Nominal tagihan = `total_amount` + **kode unik 1–999** yang deterministik dari
kode order; nominal itu disimpan di `orders.charged_amount` dan ikut terisi di
pesan WhatsApp, bukan dikembalikan di response ini.

Field `paymentMethod` tidak lagi ada di kontrak. Bila dikirim, nilainya
**diabaikan** — order selalu dibuat sebagai `MANUAL`. Bila penjual belum
menyiapkan metode (kolom WhatsApp kosong, saklar mati, atau migrasi belum
dijalankan), permintaan dibalas **503 PAYMENT_UNAVAILABLE** tanpa membuat order
menggantung:
```json
{"error":{"code":"PAYMENT_UNAVAILABLE",
          "message":"Penjual belum mengatur nomor WhatsApp untuk pembayaran. Silakan hubungi penjual."}}
```
Rate limit 10 order / 10 menit / user (429).

### GET /api/orders
Daftar order milik sendiri (maks 30, terbaru dulu):
`{ok, orders:[{order_code, product_name, quantity, total_amount, charged_amount,
payment_status, order_status, payment_method, manual_claim_at, created_at}]}`

### GET /api/orders/{order_code}
Detail order milik sendiri (`toBuyerOrderPublic` — field internal & kolom
provider warisan disaring). 404 bila bukan milikmu (tidak membocorkan keberadaan).

### GET /api/orders/{order_code}/status
Polling ringan (hanya baca DB, tanpa memanggil layanan luar):
`{ok, order_code, payment_status, order_status, total_amount, charged_amount,
paid_at, payment_expired_at, payment_method, manual_claim_at,
manual_review_status, manual_review_note, server_time}`

### GET /api/payments/status?order=ORD-...
Endpoint yang dipakai halaman `/pay/[code]` (polling 8 detik). Membaca DB
**dan** menjalankan pengecekan kadaluarsa: order `PENDING` yang **belum
diklaim** dan sudah lewat `payment_expired_at` (+ grasi 30 detik) ditandai
`EXPIRED`. Tidak ada panggilan ke provider dan tidak ada field
`checked_provider` lagi.
- Kepemilikan: buyer hanya order miliknya; admin boleh order mana pun (404 bila tidak ada).
- Batas 30 req/menit/user (429).
- **Status PAID tidak pernah bisa dipicu dari endpoint ini.**

### Klaim pembayaran manual (server action, bukan REST)
`claimManualPaymentAction` (`src/app/pay/actions.ts`) — dipanggil tombol
"Saya sudah transfer" di `/pay/[code]`. Input: `orderCode`, `note` (maks 200),
`reference` (maks 60). Mencatat `manual_claim_at` + notifikasi Telegram ke penjual.
**Tidak pernah** mengubah `payment_status`; idempoten (klaim kedua = no-op);
rate limit 10/10 menit/user; 409 bila order bukan `MANUAL` / sudah lunas /
sudah ditutup (kadaluarsa) atau datanya sudah punya klaim.

## Admin (role `admin` — dicek server-side per request)

### GET /api/admin/products
`{ok, products:[…]}` — termasuk non-aktif.
### POST /api/admin/products
```jsonc
{ "name":"Kopi 250g", "description":"…", "price":85000,
  "image_url":"https://…", "is_active":true }
```
Validasi: name 2–120, price 1.000–100.000.000 int, image https-opsional.
→ `201 {ok, product}`.
### PATCH /api/admin/products/{id}
Subset field yang sama (parsial). Nonaktifkan produk: `{"is_active":false}`.
### DELETE /api/admin/products/{id}
Hapus produk. `200 {ok, deleted:true}`.
- ID bukan UUID → 400.
- Produk tidak ada → 404.
- Masih ada pesanan dengan `order_status` selain `cancelled`/`refunded`
  (tidak peka huruf) → 409
  `"Produk tidak bisa dihapus karena masih ada pesanan aktif."`
- FK `orders.product_id … on delete restrict` tetap menolak bila ada baris
  order yang mereferensi produk (termasuk balapan setelah pengecekan) — API
  memetakan pelanggaran itu ke 409 yang sama, bukan 500.

### GET /api/admin/orders?status=PAID&q=ORD-...
`{ok, count, orders:[OrderRow…]}` (maks 200 terbaru). `status=CLAIM` → antrian
verifikasi transfer manual (klaim tertua dulu).
### GET /api/admin/orders/{codeAtauId}
`{ok, order}` — order_code publik ATAU uuid internal. Order arsip
(`payment_method` = `STENLY`/`YOBASEPAY`) tetap terkirim apa adanya.
### PATCH /api/admin/orders/{codeAtauId}/status
`{"action":"process"|"complete"}` — transisi PAID→PROCESSING→DONE (guard
idempoten + cek `payment_status=PAID`). Salah kondisi → 409 CONFLICT.
(Endpoint internal UI juga mendukung `expire` untuk admin membatalkan PENDING:
`src/app/admin/actions.ts`.) Tidak ada lagi aksi "Cek Pembayaran" — tidak ada
provider yang bisa ditanya.

### Verifikasi pembayaran manual & pengaturan (server action admin)
`src/app/admin/actions.ts`:

| Action | Input | Efek |
|---|---|---|
| `confirmManualPaymentAction` | `orderId`, `receivedAmount?`, `note?` | order `MANUAL` → `PAID` (`applyPaid`, sumber `manual`) + Telegram "LUNAS". `receivedAmount` < total order → 409; nominalnya disimpan di `charged_amount` |
| `rejectManualClaimAction` | `orderId`, `note?` | klaim dibersihkan → buyer boleh konfirmasi ulang; `manual_review_status=REJECTED` |
| `saveManualPaymentSettingsAction` | `is_enabled`, `whatsapp_number` (**wajib**), `label`, `account_name`, `instructions`, `whatsapp_message_template`, `expiry_minutes` | simpan konfigurasi WhatsApp; nomor dinormalisasi `62…`; redirect `/admin/settings?saved=1` |

`GET /api/admin/orders?status=CLAIM` → antrian order manual yang menunggu
verifikasi (klaim tertua dulu).

## Auth
Register/login/logout/reset tidak lewat API custom — klien memanggil **Supabase
Auth #1** (via server action, cookie session). Link email selalu mendarat di:
### GET /auth/callback?token_hash=…&type=email|recovery[&next=/…]
(juga menerima `?code=…` untuk PKCE) → membuat session → redirect.

## Alat publik: TikTok Downloader

### GET /api/tiktok?url=https://www.tiktok.com/@user/video/…
**Tanpa login, tanpa database** — halaman `/tiktok` memakainya untuk mengambil
info & tautan media sebuah video TikTok lewat API pihak ketiga (tikwm.com).
```jsonc
{ "ok": true, "title": "…", "cover": "https://…",
  "play": "https://…",   // tanpa watermark
  "wmplay": "https://…", // dengan watermark
  "music": "https://…",  // audio saja
  "duration": 15, "author": { "nickname": "…", "avatar": "https://…" } }
```
- URL divalidasi: hanya host `tiktok.com` (termasuk `vm.`/`vt.`/`m.`); tautan
  tanpa scheme (`vm.tiktok.com/…`) diterima dan dinormalkan.
- Rate limit 10 request / 60 detik / IP (429 bila lewat).
- 422 bila video tidak punya media yang bisa diunduh (postingan foto/privat);
  502/504 bila server TikTok tidak merespons (timeout 15 detik).
- Endpoint ini **tidak menyentuh** order, pembayaran, maupun Supabase.

## Konvensi yang berlaku di semua endpoint
1. Input divalidasi zod (400 rapi, pesan pertama).
2. Otorisasi sebelum query (requireUser / requireVerifiedUser / requireAdmin).
3. Mutasi sensitif memakai service role server-side; tidak pernah menerima
   field `payment_status/order_status/price/total_amount` dari klien.
4. Rate limit in-memory (best-effort; produksi disarankan Cloudflare).
5. Timeout 6 detik ke Telegram — tidak ada request menggantung.
