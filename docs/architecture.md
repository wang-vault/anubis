# Arsitektur

## 1. Prinsip desain

1. **Serverless murni** — hanya Vercel (Next.js) + 2 Supabase. Tidak ada VPS,
   tidak ada worker, tidak ada cron wajib. Semua "otomasi" terjadi karena
   request masuk (webhook/polling) atau aksi penjual di dashboard.
2. **Client tidak pernah dipercaya.** Klien hanya mengirim *maksud* (pilih
   produk, jumlah, nomor WA). Harga, total, status bayar, status order, role —
   semuanya dihitung/ditegakkan di server.
3. **Dua database, satu arah.** Supabase #1 (akun) tidak tahu-menahu soal
   transaksi; Supabase #2 (toko) tidak menyimpan user. Penghubungnya
   `account_id` (UUID auth user #1) yang ditulis server-side.
4. **Webhook = sumber kebenaran pembayaran; polling = UX.** Halaman bayar
   boleh bertanya tiap 8 detik, tapi status final tetap dari signature-verified
   webhook atau cek status privat ke provider — dua-duanya lewat server.
   Untuk **pembayaran manual** tidak ada provider: sumber kebenarannya adalah
   **aksi penjual** di dashboard (konfirmasi/tolak klaim buyer). Klaim buyer
   tidak pernah mengubah status.
5. **Sederhana & bisa dikelola pemilik toko**: tanpa keranjang multi-item,
   tanpa fitur sosial; satu order = satu produk (jumlah n×).

## 2. Alur lengkap (happy path)

```
1  Buyer: /auth/register (nama, email, password, WA)
        │  server action → Supabase #1 signUp → DB trigger buat profiles row
        ▼                → email verifikasi (template token_hash → /auth/callback)
2  Buyer klik link email → GET /auth/callback → verifyOtp → session cookie → /auth/verify?verified=1
3  Buyer: /auth/login → session (httpOnly cookie, refresh di middleware)
4  Pilih produk → /products/[id] → /checkout?product=...
        (middleware memaksa login; halaman memaksa email verified)
5  Submit checkout → server action:
        validasi → ambil produk+harga dari Supabase #2 → total = price×qty (server)
        → tentukan metode (resolvePaymentMethod: env + pengaturan penjual)
           Catatan UI: halaman checkout MERENDER kedua opsi lewat
           getCheckoutPaymentMethods() — manual pertama & default; QRIS otomatis
           bisa dipilih bila env YOBASEPAY_* terisi, dan disabled ber-badge
           "Ongoing" bila belum (order YOBASEPAY juga bisa dibuat via
           POST /api/orders)
        → INSERT orders (PENDING/PENDING, order_code ORD-YYYYMMDD-XXXXXX, snapshot, payment_method)
        ├─ YOBASEPAY: GET action=createpayment&amount=TOTAL → { trx_id, payment_url, qr_image, expired_at }
        │             → UPDATE orders (payment_id, payment_url, qr_image_url, payment_expired_at)
        └─ MANUAL   : tanpa provider → charged_amount = total + kode unik(order_code)
                      payment_expired_at = now + expiry_minutes (pengaturan penjual)
        → redirect /pay/[order_code]
6  Buyer scan QRIS. YoBasePay memantau mutasi.
6b (MANUAL) Buyer scan QR statis penjual → transfer nominal persis → tekan
        "Saya sudah transfer" → UPDATE manual_claim_at + catatan (+ Telegram
        "🧾 KLAIM TRANSFER MANUAL"). Status MASIH PENDING.
        Penjual cek mutasi → [✓ Konfirmasi Lunas] → applyPaid(source="manual")
        → PAID + Telegram "🔔 PESANAN BARU" ; atau [✕ Tolak Klaim] → buyer
        boleh konfirmasi ulang. Halaman buyer menangkap perubahan via polling.
7  Saat lunas (QRIS otomatis): YoBasePay POST /api/webhooks/yobasepay
        verifikasi HMAC (raw body, constant-time) → cari order via payment_id
        → validasi nominal (total ≤ amount ≤ total + toleransi kode unik)
        → UPDATE … WHERE payment_status IN ('PENDING','EXPIRED')   ← idempoten
        → order_status: PENDING → PAID ; paid_at ; klaim telegram_notified_at
        → setelah respons 200: kirim Telegram ke penjual (after())
8  Penjual terima "🔔 PESANAN BARU" → buka /admin/orders?status=PAID
        → [Proses Pesanan] (PAID→PROCESSING) → [Chat WhatsApp] (wa.me/…)
        → kirim barang manual → [Tandai Selesai] (→DONE)
9  Buyer pantau /orders/[code] — timeline dari status DB real.
```

Jalur gagal: `EXPIRED` (webhook expired / provider expired / melewati
`payment_expired_at` + grasi 30 dtk saat dicek), provider down saat create →
order ditandai `payment_status=FAILED, order_status=EXPIRED` supaya tidak
menggantung, buyer bisa order ulang.

## 3. State machine order

```
            (webhook/polling, nominal sah)
 PENDING ────────────────────────────────▶ PAID ──[Proses]──▶ PROCESSING ──[Selesai]──▶ DONE
   │                                        │                      │
   │ [Expire oleh admin] / webhook EXPIRED   │ [Selesai langsung]  │
   ▼                                        ▼                      │
 EXPIRED ◀─────────────────────────────────────────────────────────┘ (tidak ada transisi balik)
```

- Transisi PAID otomatis (hanya webhook/cek provider) dengan guard `WHERE payment_status IN ('PENDING','EXPIRED')` — webhook dobel = no-op.
- Aksi admin via `adminTransition()` (lib/orders.ts): hanya `process`, `complete`, `expire` sesuai tabel di atas; balapan dengan webhook → 409 "status berubah".
- `EXPIRED→PAID` dimungkinkan jika pembayaran sah tiba telat (uang diterima = lunas; dicatat di log). `DONE` tidak pernah diturunkan.

## 4. Skema data

**Supabase #1 — `public.profiles`** (lihat `supabase/account/001_schema.sql`)
`id (=auth.users.id) · name · email · whatsapp · role('buyer'|'admin') · created_at · updated_at`
+ trigger `handle_new_user` (isi profil saat signup), trigger anti-ubah-role,
updated_at; RLS: select/update baris sendiri saja; anon: tidak ada akses.

**Supabase #2** (lihat `supabase/store/001_schema.sql`)
- `products`: `id · name · description · price(bigint Rp) · image_url · is_active · timestamps`
- `orders`: `id · order_code(unique) · account_id · product_id(FK) ·
  product_name_snapshot · unit_price_snapshot · quantity · total_amount ·
  charged_amount(nominal final termasuk kode unik) · payment_status ·
  order_status · payment_method('YOBASEPAY'|'MANUAL') · payment_id(unique) ·
  payment_url · qr_image_url · payment_expired_at · last_payment_checked_at ·
  paid_at · telegram_notified_at · buyer_name/whatsapp/email_snapshot ·
  timestamps` + kolom jejak pembayaran manual: `manual_claim_at/note/
  reference/notified_at` (klaim buyer) dan `manual_reviewed_at/reviewed_by/
  review_status(APPROVED|REJECTED)/review_note` (verifikasi penjual)
- `manual_payment_settings`: satu baris (`id=1`) konfigurasi metode manual —
  `is_enabled · label · account_name · instructions · expiry_minutes ·
  qr_image_mime/base64/size`; RLS tanpa policy (hanya service role), gambar
  disajikan ulang lewat `GET /api/manual-qr`

Snapshot nama/harga/kontak disimpan di order → histori tidak berubah kalau
produk diedit nanti. Indexes: katalog aktif, order per-account, antrian
`PAID/PROCESSING`, lookup `payment_id`, expiry scan.

## 5. Keamanan model (ringkas — detail di security.md)

| Ancaman | Pertahanan |
|---|---|
| Manipulasi harga dari form | Total dihitung ulang dari DB (select price saat create order) |
| "Saya sudah bayar" dari klien | Status PAID hanya dari webhook ber-signature / checkstatus API privat / **konfirmasi penjual** (manual) — klaim buyer hanya mengisi antrian verifikasi |
| Webhook palsu | HMAC-SHA256 raw-body, constant-time compare; invalid → 403 |
| Webhook replay/dobel | Update bersyarat idempoten + nominal check + klaim notif sekali |
| Buyer akses admin | `requireAdmin()` cek `profiles.role` (DB) di setiap aksi admin + layout; RLS tidak memberi akses |
| Buyer ubah status/profil orang lain | RLS own-row; orders deny-all untuk anon/authenticated; semua mutate lewat server |
| Service key bocor ke bundle | Import dari modul `server-only`; env tanpa prefix NEXT_PUBLIC; audit grep + docs |
| Brute force login/register | Rate limit in-memory (best-effort serverless) + Cloudflare (disarankan) |
| Enumeration order ID | Kode publik acak `ORD-YYYYMMDD-XXXXXX`; query selalu difilter kepemilikan |
| Open redirect `?next=` | `sanitizeNextPath()` hanya path relatif |

## 6. Performa

- Semua halaman dirender server (tanpa data di JS); interaktivitas klien
  hanya: form (useActionState → server action), stepper checkout, panel
  pembayaran (polling 8 dtk). First Load JS ±106 kB.
- Katalog di-cache via `unstable_cache` (60 detik, tag `products`); mutation
  admin memanggil `revalidateTag('products')` → perubahan instan tanpa rebuild.
- Polling status tidak membanjiri YoBasePay: throttle server 1 cek/10 dtk/order
  (`last_payment_checked_at`) + limiter 30/menit/user.
- Gambar: `<img loading="lazy">` (tanpa runtime optimizer — lihat catatan di
  admin-guide soal hosting gambar; bisa ditingkatkan ke next/image bila host
  gambar tetap).

## 7. Abstraksi yang bisa diganti

- `src/lib/integrations/payment/types.ts` — interface `PaymentProvider`
  (createPayment/checkStatus/verifyWebhookSignature/normalizeWebhook).
  `yobasepay.ts` satu-satunya yang tahu API YoBasePay → ganti provider =
  implementasi baru + daftarkan di `payment/index.ts`.
- `src/lib/integrations/telegram.ts` — interface `Notifier`
  (`notifyOrderPaid`). Bila Telegram tidak diisi: `DisabledNotifier`
  (log, tidak mengirim, tidak mengganggu pembayaran). Ini bukan "mock
  payment" — tidak ada jalur palsu yang menandai order lunas.
- Env `YOBASEPAY_BASE_URL` & `YOBASEPAY_AMOUNT_TOLERANCE` memisahkan asumsi
  provider (kode unik, endpoint) dari kode bisnis.
- `src/lib/payment-config.ts` memisahkan **ketersediaan** (apa yang boleh
  dieksekusi server: `getAvailablePaymentMethods()`/`resolvePaymentMethod()`)
  dari **daftar tampilan checkout** (`getCheckoutPaymentMethods()`), tetapi
  keduanya membaca sumber yang sama (`yobasepayConfigured()` + pengaturan
  manual penjual): QRIS otomatis tampil & bisa dipilih bila kredensial terisi,
  dan jatuh ke badge "Ongoing" (disabled) bila belum — tanpa menyentuh state
  machine order.
