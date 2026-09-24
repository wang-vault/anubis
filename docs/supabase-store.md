# Supabase #2 — STORE (Products + Orders)

Project khusus: katalog, order, status pembayaran/order, info operasional toko.
**Tidak ada Auth/user di project ini** (akun hidup di #1; kolom
`orders.account_id` menyimpan UUID user #1 sebagai referensi logis).

## 1. Buat project & credentials

Sama seperti #1 (`docs/deployment.md` §A/B): New project → `anubis-store`,
region Singapore. Ambil **URL**, **anon**, **service_role** →
`NEXT_PUBLIC_SUPABASE_STORE_URL`, (`NEXT_PUBLIC_SUPABASE_STORE_ANON_KEY`, opsional),
`SUPABASE_STORE_SERVICE_ROLE_KEY`.

## 2. Jalankan SQL

SQL Editor → paste `supabase/store/001_schema.sql` → Run, lalu (untuk project
lama) `supabase/store/002_manual_payment.sql` dan
`supabase/store/004_whatsapp_payment.sql` → Run.

- `002` = migrasi pembayaran manual (kolom `payment_method`, `manual_*`, tabel
  `manual_payment_settings`).
- `004` = migrasi WhatsApp: kolom `whatsapp_number` + `whatsapp_message_template`,
  default `payment_method = 'MANUAL'`, dan label default versi WhatsApp.

Untuk project baru keduanya sudah tercakup `001` sehingga menjadi no-op; untuk
project lama keduanya inilah yang menambahkan kolomnya. Semua idempoten (aman
diulang) dan tidak pernah mengubah/menghapus baris order. Bila `002`/`004`
dilewati, aplikasi gagal dengan `column orders.payment_method does not exist`
(`docs/troubleshooting.md` §18) atau menampilkan status `schema_missing` di
`/admin/settings`. File `003_stenly_payment.sql` hanya riwayat migrasi provider
QRIS otomatis yang sudah dihapus dari kode — tidak perlu dijalankan untuk
instalasi baru.

Hasil:

### Tabel `products`
| Kolom | Ket |
|---|---|
| `id` | uuid pk |
| `name`, `description` | text; name 2–120 char |
| `price` | **bigint Rupiah penuh**, check 1.000–100.000.000 |
| `image_url` | text nullable (https, diisi owner) |
| `is_active` | boolean default true |
| `created_at/updated_at` | trigger auto-update |

### Tabel `orders`
Snapshot (`product_name_snapshot`, `unit_price_snapshot`,
`buyer_*_snapshot`) dibuat **saat order dibuat** → edit produk tidak mengubah
histori. Status: `payment_status` ∈ PENDING/PAID/FAILED/EXPIRED,
`order_status` ∈ PENDING/PAID/PROCESSING/DONE/EXPIRED (check constraints —
status liar ditolak DB). `payment_id` (warisan: dulu berisi `order_id` provider)
tetap ada dengan **unique partial index** demi order arsip, tetapi **selalu
NULL** untuk order baru. `telegram_notified_at` =
kunci anti-notifikasi-ganda. Indexes untuk katalog, riwayat per-buyer, antrian
kerja admin, lookup webhook, scan expiry, dan antrian klaim manual.

Kolom **metode pembayaran**: `payment_method` default `'MANUAL'`
(check constraint mengizinkan `MANUAL` + nilai arsip `STENLY`/`YOBASEPAY` agar
order lama tetap valid dibaca; tidak ada baris order yang pernah ditulis ulang).
Untuk order `MANUAL`: `charged_amount` = total + kode unik,
`payment_id` selalu NULL, dan kolom `manual_claim_at`, `manual_claim_note`,
`manual_claim_reference`, `manual_claim_notified_at` (klaim buyer) serta
`manual_reviewed_at`, `manual_reviewed_by`, `manual_review_status`
(`APPROVED`/`REJECTED`), `manual_review_note` (verifikasi penjual) — semuanya
hanya ditulis server-side. Detail alur: `docs/manual-payment.md`.

### Tabel `manual_payment_settings` (satu baris, `id = 1`)
Konfigurasi pembayaran manual via WhatsApp: `is_enabled`, `label`,
`account_name`, `instructions`, `expiry_minutes` (10–4320), `whatsapp_number`
(nomor penjual, dinormalisasi `62…`), `whatsapp_message_template`
(placeholder `{toko} {kode} {produk} {jumlah} {total} {nama}`), `updated_at`.

Kolom warisan `qr_image_mime`, `qr_image_base64`, `qr_image_size` **dibiarkan
ada** (migrasi 004 tidak menghapusnya) agar data lama tidak hilang, tetapi tidak
pernah dibaca/ditulis kode baru dan tidak ada lagi endpoint gambar QR.
RLS aktif tanpa policy — hanya service role (server) yang bisa baca/tulis.

### RLS (inti keamanannya)
```
products → policy "products_read_active": SELECT untuk anon/authenticated
            HANYA WHERE is_active (katalog publik = boleh dibaca)
            → tidak ada policy INSERT/UPDATE/DELETE: tulis mustahil dari client.
orders   → RLS ON, TANPA policy apa pun = deny-all.
```
Artinya:
- Browser buyer/admin **tidak bisa** membaca/menulis `orders` langsung
  (termasuk melihat order orang lain, mengubah `payment_status`, dsb).
- Semua akses orders via API server (`service_role`) yang **wajib** menyaring
  `account_id` milik session user (kepemilikan) atau role admin — kode di
  `src/lib/orders.ts`.
- Client `anon` yang suatu saat dipakai tetap tidak bisa menyentuh orders;
  hanya produk aktif yang terlihat.

## 3. Testing create order + payment update (SQL Editor, simulasi manual)

```sql
-- 1) aktifkan produk contoh milik Anda sendiri (BUKAN data dummy aplikasi):
insert into public.products (name, description, price, is_active)
values ('Uji Produk', 'untuk tes', 10000, true) returning id;

-- 2) simulasikan order + payment (UUID account_id = id user uji Anda di #1):
insert into public.orders (order_code, account_id, product_id, product_name_snapshot,
  unit_price_snapshot, quantity, total_amount, charged_amount, payment_method)
values ('ORD-20260911-TEST01','<uuid-user-#1>','<uuid-produk>','Uji Produk',10000,1,10000,10417,'MANUAL')
returning id;

-- 3) transisi "lunas" seperti dilakukan aplikasi:
update public.orders
   set payment_status='PAID', order_status='PAID', paid_at=now()
 where id='<uuid-order>' and payment_status in ('PENDING','EXPIRED');

-- 4) ulangi UPDATE di no.3 → "0 baris" = bukti idempotensi guard bekerja.

-- 5) bersih-bersih:
delete from public.orders where order_code='ORD-20260911-TEST01';
delete from public.products where name='Uji Produk';
```

### Test akses langsung via REST (harus GAGAL)

```bash
# anon key project #2 tidak boleh bisa membaca orders:
curl "https://<ref2>.supabase.co/rest/v1/orders?select=*" -H "apikey: <STORE_ANON_KEY>"
# → HTTP 401 / [] ✅ (RLS deny-all)

# produk aktif BOLEH dibaca publik:
curl "https://<ref2>.supabase.co/rest/v1/products?select=name,is_active" -H "apikey: <STORE_ANON_KEY>"
# → daftar produk ✅
```

### Test admin access
Lewat aplikasi: login admin → `/admin/products` (CRUD) & `/admin/orders`
(transisi) — keduanya memanggil API `/api/admin/*` yang mengecek
`profiles.role='admin'` **di server** (#1) sebelum menyentuh #2.
Sebagai buyer, coba `curl -X PATCH /api/admin/products/<id> -b "<cookie buyer>"`
→ `403 FORBIDDEN` ✅.

## 4. Catatan operasional

- `price` integer: input form sudah menolak nilai < 1000; jangan pakai sen/pecahan.
- Non-aktif produk = `is_active=false` (order lama tetap utuh, produk hilang
  dari katalog & checkout menolak).
- Hapus permanen lewat `DELETE /api/admin/products/{id}` (tombol di halaman
  edit). Ditolak (409) bila masih ada pesanan yang statusnya bukan
  cancelled/refunded. FK `on delete restrict` tetap menolak penghapusan bila
  ada baris order yang mereferensi produk — disengaja, agar histori tidak
  menggantung.
- Tidak ada backup otomatis? Supabase free/hobby = backup 7 hari; produksi:
  nyalakan PITR bila paket Anda menyediakan. Minimal: rutin
  `pg_dump` via **Database → Database Settings → Connection string**.
