# API Reference

Base: `https://<domain>`. Format error seragam:
`{"error":{"code":"<KODE>","message":"<pesan aman untuk user>"}}` —
detail internal hanya ke log (Vercel Runtime Logs).

Kode HTTP yang dipakai: 400 VALIDATION_ERROR · 401 UNAUTHORIZED ·
403 EMAIL_NOT_VERIFIED / FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT ·
429 TOO_MANY_REQUESTS · 503 PAYMENT_UNAVAILABLE · 500 INTERNAL_ERROR.

Auth cookie: semua endpoint buyer membaca session Supabase #1 dari httpOnly
cookie (browser mengirim otomatis; dari curl pakai `-b "sb-<ref>-auth-token=…"`).

## Orders & Payment (buyer)

### POST /api/orders
Buat order + pembayaran.
```jsonc
// request
{ "productId": "uuid", "quantity": 1,        // 1..20
  "paymentMethod": "MANUAL" }                // opsional: MANUAL | YOBASEPAY
// 201 response (QRIS otomatis)
{ "ok": true,
  "order":   { "order_code":"ORD-20260911-AB7K2M","total_amount":25000,
               "order_status":"PENDING","payment_status":"PENDING" },
  "payment": { "paymentId":"YO-ABC123","paymentUrl":"https://…","qrImageUrl":"https://…png","expiresAt":"2026-09-11T05:30:00.000Z" } }
// 201 response (transfer manual) — tidak ada transaksi provider
{ "ok": true,
  "order":   { "order_code":"ORD-20260912-MANU4L","total_amount":50000, … },
  "payment": { "paymentId":null,"paymentUrl":null,
               "qrImageUrl":"/api/manual-qr?v=…","expiresAt":"2026-09-12T14:30:00.000Z" } }
```
Syarat: login + email verified. Harga dari DB, BUKAN dari request.
`paymentMethod` yang tidak tersedia (mis. QRIS otomatis belum aktif) → 409;
tidak diisi → memakai `DEFAULT_PAYMENT_METHOD` / satu-satunya metode aktif.
Gagal provider → 503 (order ditandai FAILED/EXPIRED agar tidak menggantung).

### GET /api/orders
Daftar order milik sendiri (maks 30, terbaru dulu).

### GET /api/orders/{order_code}
Detail order milik sendiri. 404 bila bukan milikmu (tidak membocorkan keberadaan).

### GET /api/orders/{order_code}/status
Polling ringan (hanya DB):
`{ok, order_code, payment_status, order_status, total_amount, paid_at, payment_expired_at,
payment_method, manual_claim_at, manual_review_status, manual_review_note, server_time}`

### GET /api/manual-qr
Gambar QRIS statis penjual (PNG/JPG/WebP) yang di-upload dari `/admin/settings`.
Publik + `Cache-Control: public, max-age=300` (QRIS statis memang untuk
dipindai siapa pun). 404 bila belum diunggah; 302 ke `MANUAL_PAYMENT_QR_IMAGE_URL`
bila env itu diisi.

### Klaim pembayaran manual (server action, bukan REST)
`claimManualPaymentAction` (`src/app/pay/actions.ts`) — dipanggil tombol
"Saya sudah transfer" di `/pay/[code]`. Input: `orderCode`, `note`, `reference`.
Mencatat `manual_claim_at` + notifikasi Telegram ke penjual.
**Tidak pernah** mengubah `payment_status`; idempoten (klaim kedua = no-op);
rate limit 10/10 menit/user; 409 bila order bukan manual / sudah lunas / sudah ditutup.

### GET /api/payments/status?order=ORD-...
Sinkronisasi + polling endpoint untuk halaman bayar:
- membaca DB, dan bila masih PENDING (maks 1x/10 detik per order) menanyakan
  `action=checkstatus` ke YoBasePay dengan API KEY SERVER, lalu menyimpan hasil
  (termasuk transisi PAID/EXPIRED + notifikasi Telegram).
- Batas 30 req/menit/user (429).
Response: seperti status di atas + `checked_provider: boolean`.

## Webhook

### POST /api/webhooks/yobasepay
Raw body JSON dari YoBasePay + header `X-YoBasePay-Signature`
(HMAC-SHA256 hex atas raw body, secret = `YOBASEPAY_WEBHOOK_SECRET`).

| Situasi | HTTP | Body |
|---|---|---|
| Signature salah/hilang | 403 | `{"error":{"code":"INVALID_SIGNATURE",…}}` |
| Order lunas OK | 200 | `{"ok":true,"handled":"paid"}` |
| Webhook sama datang lagi | 200 | `{"ok":true,"handled":"paid","reason":"already_processed"}` |
| Nominal tidak sah / hilang | 200* | `{"ok":true,"handled":"ignored","reason":"amount_mismatch"}` |
| Order tidak ditemukan | 200* | `{"ok":true,"handled":"ignored","reason":"order_not_found"}` |
| Transisi EXPIRED provider | 200 | `{"ok":true,"handled":"expired"}` |
| Error DB tak terduga | 500 | provider akan retry — idempoten, aman |

\*200 disengaja agar provider berhenti retry untuk event yang memang tidak bisa
diproses; detail ada di log (`webhook_amount_invalid`, dsb).

## Admin (role `admin` — dicek server-side per request)

### GET /api/admin/products
`{ok, products:[…]}` — termasuk non-aktif.
### POST /api/admin/products
```jsonc
{ "name":"Kopi 250g", "description":"…", "price":85000,
  "image_url":"https://…", "is_active":true }
```
Validasi: name 2–120, price 1.000–100.000.000 int, image https-oppsional.
→ `201 {ok, product}`.
### PATCH /api/admin/products/{id}
Subset field yang sama (parsial). Nonaktifkan produk: `{"is_active":false}`.

### GET /api/admin/orders?status=PAID&q=ORD-...
`{ok, count, orders:[OrderRow…]}` (maks 200 terbaru).
### GET /api/admin/orders/{codeAtauId}
`{ok, order}` — order_code publik ATAU uuid internal.
### PATCH /api/admin/orders/{codeAtauId}/status
`{"action":"process"|"complete"}` — transisi PAID→PROCESSING→DONE (guard
idempoten + cek `payment_status=PAID`). Salah kondisi → 409 CONFLICT.
(Endpoint internal UI juga mendukung `expire` utk admin membatalkan PENDING:
`src/app/admin/actions.ts`.)

### GET /api/admin/payments/diagnose
Diagnosa koneksi YoBasePay **tanpa efek samping**: memanggil `checkstatus`
dengan trxid karangan (`YO-DIAGNOSTIK-000000`) sehingga tidak membuat
transaksi dan tidak memotong saldo, lalu menerjemahkan jawaban provider
menjadi vonis + langkah perbaikan.
→ `{ok, diagnostics:{verdict, verdictLabel, hints[], env[], domainLock,
webhookUrl, baseUrl, amountTolerance, qrRenderConfigured, probe, checkedAt}}`
Vonis: `OK_KEY_VALID` | `NOT_CONFIGURED` | `INVALID_API_KEY` | `DOMAIN_LOCK` |
`INSUFFICIENT_BALANCE` | `PLAN_MISMATCH` | `PROVIDER_UNREACHABLE` |
`BAD_RESPONSE` | `UNKNOWN`. Nilai env **disamarkan** (`maskSecret`) — rahasia
tidak pernah dikembalikan utuh. Rate limit 10/10 menit per admin.
Dipakai panel "Diagnosa QRIS Otomatis" di `/admin/settings`
(`src/components/admin/PaymentDiagnostics.tsx`). Detail: `docs/yobasepay.md` §4b.

### Verifikasi pembayaran manual (server action admin)
`src/app/admin/actions.ts`:
| Action | Input | Efek |
|---|---|---|
| `confirmManualPaymentAction` | `orderId`, `receivedAmount?`, `note?` | order manual → `PAID` (`applyPaid`, sumber `manual`) + Telegram "LUNAS" |
| `rejectManualClaimAction` | `orderId`, `note?` | klaim dibersihkan → buyer boleh konfirmasi ulang; `manual_review_status=REJECTED` |
| `saveManualPaymentSettingsAction` | `label`, `account_name`, `instructions`, `expiry_minutes`, `is_enabled`, `qr_image` (File) | simpan konfigurasi + gambar QR (maks 900 KB) |

`GET /api/admin/orders?status=CLAIM` → antrian order manual yang menunggu
verifikasi (klaim tertua dulu).

## Auth
Register/login/logout/reset tidak lewat API custom — klien memanggil **Supabase
Auth #1** (via server action, cookie session). Link email selalu mendarat di:
### GET /auth/callback?token_hash=…&type=email|recovery[&next=/…]
(juga menerima `?code=…` untuk PKCE) → membuat session → redirect.

## Konvensi yang berlaku di semua endpoint
1. Input divalidasi zod (400 rapi, pesan pertama).
2. Otorisasi sebelum query (requireUser / requireVerifiedUser / requireAdmin).
3. Mutasi sensitive memakai service role server-side; tidak pernah menerima
   field `payment_status/order_status/price/total_amount` dari klien.
4. Rate limit in-memory (best-effort; produksi disarankan Cloudflare).
5. Timeout 15 dtk ke provider, 6 dtk ke Telegram — tidak ada request menggantung.
