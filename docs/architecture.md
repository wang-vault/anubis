# Arsitektur

## 1. Prinsip desain

1. **Serverless murni** — hanya Vercel (Next.js) + 2 Supabase. Tidak ada VPS,
   tidak ada worker, tidak ada cron wajib, tidak ada payment gateway. Semua
   "otomasi" terjadi karena request masuk atau aksi penjual di dashboard.
2. **Client tidak pernah dipercaya.** Klien hanya mengirim *maksud* (pilih
   produk, jumlah, nomor WA). Harga, total, status bayar, status order, role —
   semuanya dihitung/ditegakkan di server. Buyer **tidak punya** jalur apa pun
   untuk menandai ordernya lunas.
3. **Dua database, satu arah.** Supabase #1 (akun) tidak tahu-menahu soal
   transaksi; Supabase #2 (toko) tidak menyimpan user. Penghubungnya
   `account_id` (UUID auth user #1) yang ditulis server-side.
4. **Mutasi penjual = sumber kebenaran pembayaran; chat WhatsApp = kanal detail
   pembayaran.** Aplikasi sengaja tidak menyimpan QR/nomor rekening: penjual
   mengirimnya di chat, jadi tidak pernah basi. Halaman bayar boleh bertanya
   tiap 8 detik, tapi status final hanya lahir dari aksi penjual di server.
   Klaim buyer tidak pernah mengubah status.
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
        validasi (productId + quantity) → ambil produk+harga dari Supabase #2
        → total = price×qty (server)
        → resolvePaymentMethod(): cek kesiapan metode manual
             (env MANUAL_PAYMENT_ENABLED + saklar DB + nomor WA penjual)
             belum siap → 503 dengan alasan, TANPA membuat order
        → INSERT orders (PENDING/PENDING, order_code ORD-YYYYMMDD-XXXXXX,
          snapshot, payment_method='MANUAL',
          charged_amount = total + kode unik(order_code),
          payment_expired_at = now + expiry_minutes (pengaturan penjual))
        → redirect /pay/[order_code]
6  Buyer menekan "💬 Buka WhatsApp Penjual" → wa.me/<nomor penjual>?text=<pesan
        terisi kode order, produk, jumlah, nominal> (lib/whatsapp.ts, template
        bisa diubah penjual). Penjual mengirim detail pembayaran (QRIS statis /
        rekening / e-wallet) di chat tersebut.
6b Buyer transfer nominal PERSIS → tekan "Saya sudah transfer"
        → server action claimManualPaymentAction → UPDATE manual_claim_at,
          manual_claim_note, manual_claim_reference (+ Telegram
          "🧾 KLAIM TRANSFER MANUAL" sekali). Status MASIH PENDING.
        Penjual cek mutasi → [✓ Konfirmasi Lunas] → applyPaid(source="manual",
          charged_amount=nominal masuk) → PAID + Telegram "🔔 PESANAN BARU" ;
          atau [✕ Tolak Klaim] → buyer boleh konfirmasi ulang.
        Halaman buyer menangkap perubahan via polling 8 dtk
        (GET /api/payments/status — hanya baca DB + cek kadaluarsa).
7  Order PENDING yang BELUM diklaim dan sudah lewat payment_expired_at
        (+ grasi 30 dtk) ditandai EXPIRED saat status dicek. Order yang sudah
        diklaim tidak pernah di-expire otomatis.
8  Penjual terima "🔔 PESANAN BARU" → buka /admin/orders?status=PAID
        → [Proses Pesanan] (PAID→PROCESSING) → [Chat WhatsApp] (wa.me/…)
        → kirim barang manual → [Tandai Selesai] (→DONE)
9  Buyer pantau /orders/[code] — timeline dari status DB real.
```

Jalur gagal: metode belum siap saat checkout → **503** (tidak ada order
menggantung). Order tak dibayar → `EXPIRED` oleh pengecekan expiry atau aksi
**✕ Expire** admin. Tidak ada state `FAILED` yang lahir dari provider lagi
(kolomnya tetap ada untuk order arsip).

## 3. State machine order

```
 PENDING ──[Konfirmasi penjual]──▶ PAID ──[Proses]──▶ PROCESSING ──[Selesai]──▶ DONE
   │                                │                      │
   │ [Expire otomatis saat dicek]    │ [Selesai langsung]   │
   ▼  atau [✕ Expire oleh admin]     ▼                      │
 EXPIRED ◀──────────────────────────────────────────────────┘ (tidak ada transisi balik)
```

- Transisi PAID hanya lewat `adminConfirmManualPayment()` (guard
  `WHERE payment_status IN ('PENDING','EXPIRED')` + `payment_method='MANUAL'`),
  jadi klik ganda = 409, bukan dua notifikasi.
- Aksi admin via `adminTransition()` (lib/orders.ts): hanya `process`,
  `complete`, `expire` sesuai tabel di atas; balapan antar-aksi → 409
  "status berubah".
- Order **arsip** (`payment_method` = `STENLY`/`YOBASEPAY`) tidak bisa
  dikonfirmasi lewat jalur manual (409) dan tidak pernah ditulis ulang.
- `DONE` tidak pernah diturunkan.

## 4. Skema data

**Supabase #1 — `public.profiles`** (lihat `supabase/account/001_schema.sql`)
`id (=auth.users.id) · name · email · whatsapp · role('buyer'|'admin') · created_at · updated_at`
+ trigger `handle_new_user` (isi profil saat signup), trigger anti-ubah-role,
updated_at; RLS: select/update baris sendiri saja; anon: tidak ada akses.

**Supabase #2** (lihat `supabase/store/001_schema.sql`, migrasi
`002_manual_payment.sql` + `004_whatsapp_payment.sql`)
- `products`: `id · name · description · price(bigint Rp) · image_url · is_active · timestamps`
- `orders`: `id · order_code(unique) · account_id · product_id(FK) ·
  product_name_snapshot · unit_price_snapshot · quantity · total_amount ·
  charged_amount(nominal final termasuk kode unik) · payment_status ·
  order_status · payment_method(default 'MANUAL'; 'STENLY'/'YOBASEPAY' hanya
  pada order arsip) · payment_id/payment_url/qr_image_url (warisan, selalu NULL
  untuk order baru) · payment_expired_at · last_payment_checked_at(warsan,
  tidak lagi ditulis) · paid_at · telegram_notified_at ·
  buyer_name/whatsapp/email_snapshot · timestamps` + kolom jejak pembayaran
  manual: `manual_claim_at/note/reference/notified_at` (klaim buyer) dan
  `manual_reviewed_at/reviewed_by/review_status(APPROVED|REJECTED)/review_note`
  (verifikasi penjual)
- `manual_payment_settings`: satu baris (`id=1`) konfigurasi metode manual —
  `is_enabled · label · account_name · instructions · expiry_minutes ·
  whatsapp_number · whatsapp_message_template` (+ kolom warisan
  `qr_image_mime/base64/size` yang tidak dipakai lagi); RLS tanpa policy (hanya
  service role). Nomor WA punya cadangan env `WHATSAPP_SELLER_NUMBER`.

Snapshot nama/harga/kontak disimpan di order → histori tidak berubah kalau
produk diedit nanti. Indexes: katalog aktif, order per-account, antrian
`PAID/PROCESSING`, antrian klaim manual, scan expiry.

## 5. Keamanan model (ringkas — detail di security.md)

| Ancaman | Pertahanan |
|---|---|
| Manipulasi harga dari form | Total dihitung ulang dari DB (select price saat create order) |
| "Saya sudah bayar" dari klien | Klaim buyer hanya mengisi antrian verifikasi; status PAID hanya dari **konfirmasi penjual** (role admin dicek server-side) |
| Buyer melunasi ordernya sendiri | Tidak ada endpoint/aksi yang menerima `payment_status` dari klien; semua mutate lewat server action admin |
| Konfirmasi transfer yang belum penuh | `receivedAmount` < total order → 409; nominal masuk dicatat di `charged_amount` |
| Spam klaim transfer | Guard `manual_claim_at IS NULL` (klaim kedua no-op) + rate limit 10/10 menit/user |
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
- Polling status kini murni baca DB (tanpa panggilan keluar): limiter
  30/menit/user untuk `/api/payments/status`, dan probe kelengkapan skema
  `checkStoreSchema()` di-cache 60 detik per instance.
- Gambar: `<img loading="lazy">` (tanpa runtime optimizer — lihat catatan di
  admin-guide soal hosting gambar; bisa ditingkatkan ke next/image bila host
  gambar tetap).

## 7. Abstraksi yang bisa diganti

- `src/lib/payment-config.ts` — satu pintu konfigurasi: membaca baris
  `manual_payment_settings` + env, lalu memutuskan ketersediaan
  (`resolvePaymentMethod()`, `getCheckoutPaymentMethods()`). Detail provider
  pembayaran (webhook, HTTP client, QR) **sudah tidak ada** — kalau suatu hari
  mau menambah gateway lagi, tempatnya di sini + domain `orders.ts`, tanpa
  mengubah state machine.
- `src/lib/payment-methods.ts` + `src/lib/whatsapp.ts` — modul murni
  (tanpa I/O) untuk label metode, kode unik nominal, render template pesan dan
  link `wa.me`; semuanya ter-unit-test.
- `src/lib/integrations/telegram.ts` — interface `Notifier`
  (`notifyOrderPaid`, `notifyManualPaymentClaim`). Bila Telegram tidak diisi:
  `DisabledNotifier` (log, tidak mengirim, tidak mengganggu pembayaran). Tidak
  ada jalur palsu yang menandai order lunas.
- `src/lib/store-schema.ts` — penjaga "kode lebih baru dari database":
  mendeteksi kolom/tabel yang belum dimigrasi, menormalkan baris order, dan
  menyediakan SQL migrasi untuk banner `/admin`.
