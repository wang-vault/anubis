-- ============================================================================
-- SUPABASE #2 — STORE / COMMERCE SYSTEM
-- Jalankan file ini di: Supabase Dashboard (Project #2) → SQL Editor → New query
-- ============================================================================
-- Berisi: tabel products & orders, constraint, index, trigger updated_at,
-- RLS + policies. TIDAK ada data dummy (tidak ada produk/user/order palsu).
--
-- PENTING: project ini TIDAK memiliki user/auth sendiri. Semua akses ke
-- orders dilakukan SERVER-SIDE (Vercel API routes) memakai service_role key,
-- dengan validasi kepemilikan di kode aplikasi. Karena itu orders sengaja
-- dibuat "deny-by-default" (RLS aktif, tanpa policy) → tidak ada satu pun
-- client (browser) yang bisa membaca/menulis orders langsung ke database.
-- account_id merujuk ke UUID auth.users di Supabase #1 (cross-project, maka
-- tanpa FOREIGN KEY — ditangani di level aplikasi).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABEL products
--    price dalam RUPIAH PENUH (integer, tanpa sen). Contoh: 25000 = Rp25.000
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 120),
  description text not null default '',
  price       bigint not null check (price between 1000 and 100000000), -- Rp1.000 s.d. Rp100jt
  image_url   text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.products is 'Katalog toko. Satu seller (pemilik toko), bukan marketplace.';
comment on column public.products.price is 'Harga satuan dalam Rupiah (integer). Sumber kebenaran harga — TIDAK PERNAH memakai harga dari client.';

-- Katalog publik: hanya produk aktif yang tampil di homepage/daftar produk.
create index if not exists products_active_idx
  on public.products (is_active, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. TABEL orders
--    Satu order = satu produk (MVP tanpa keranjang).
--    Snapshot nama produk & harga satuan disimpan agar perubahan katalog
--    tidak mengubah histori transaksi.
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),
  order_code            text not null unique,          -- publik: ORD-YYYYMMDD-XXXXXX
  account_id            uuid not null,                 -- auth.users.id di Supabase #1
  product_id            uuid not null references public.products (id) on delete restrict,

  product_name_snapshot text not null,
  unit_price_snapshot   bigint not null,               -- Rupiah, disalin saat order dibuat
  quantity              int not null check (quantity between 1 and 999),
  total_amount          bigint not null check (total_amount > 0),
  -- Nominal final yang ditagihkan. QRIS otomatis (Stenly) = sama dengan
  -- total_amount; MANUAL = total + kode unik. Diisi saat create payment /
  -- webhook / polling. Nullable untuk kompatibilitas.
  charged_amount        bigint check (charged_amount is null or charged_amount > 0),

  payment_status        text not null default 'PENDING'
    check (payment_status in ('PENDING', 'PAID', 'FAILED', 'EXPIRED')),
  order_status          text not null default 'PENDING'
    check (order_status in ('PENDING', 'PAID', 'PROCESSING', 'DONE', 'EXPIRED')),

  -- Metode bayar: 'STENLY' = QRIS dinamis otomatis (provider aktif),
  -- 'MANUAL' = QRIS statis milik penjual yang diverifikasi manual dari mutasi
  -- (lihat bagian 6). 'YOBASEPAY' = provider otomatis LAMA: tetap diizinkan
  -- constraint agar histori transaksi lama tidak rusak, tetapi tidak pernah
  -- ditulis lagi oleh aplikasi.
  payment_method        text not null default 'STENLY'
    check (payment_method in ('STENLY', 'MANUAL', 'YOBASEPAY')),

  -- Pembayaran MANUAL: klaim buyer ("saya sudah transfer") + hasil verifikasi
  -- penjual. Semua kolom ini HANYA ditulis server-side.
  manual_claim_at          timestamptz,                -- buyer menekan "Saya sudah transfer"
  manual_claim_note        text not null default '',   -- catatan buyer (nama pengirim, dll.)
  manual_claim_reference   text not null default '',   -- no. referensi / ID transaksi buyer
  manual_claim_notified_at timestamptz,                -- klaim sudah dinotifikasi ke Telegram (anti ganda)
  manual_reviewed_at       timestamptz,                -- penjual memverifikasi/menolak klaim
  manual_reviewed_by       uuid,                       -- auth.users.id admin (Supabase #1)
  manual_review_status     text check (manual_review_status is null
    or manual_review_status in ('APPROVED', 'REJECTED')),
  manual_review_note       text not null default '',

  -- Informasi pembayaran (diisi server-side dari provider QRIS otomatis)
  payment_id            text,                          -- ID transaksi provider (Stenly: order_id yang kita kirim)
  payment_url           text,                          -- halaman/URL QRIS dari provider
  qr_image_url          text,                          -- gambar QR untuk ditampilkan
  payment_expired_at    timestamptz,                   -- batas waktu bayar (countdown)
  last_payment_checked_at timestamptz,                 -- throttle cek status ke provider

  paid_at               timestamptz,
  -- Penanda percobaan notifikasi Telegram (pencegahan notifikasi ganda)
  telegram_notified_at  timestamptz,

  -- Kontak buyer (snapshot saat order dibuat; dipakai tombol WhatsApp & Telegram)
  buyer_name_snapshot     text not null default '',
  buyer_whatsapp_snapshot text not null default '',
  buyer_email_snapshot    text not null default '',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.orders is 'Pesanan + status pembayaran. Hanya dapat diakses service_role (server-side).';
comment on column public.orders.order_code is 'Nomor publik unik, anti-enumeration (bukan UUID/ID mentah).';
comment on column public.orders.telegram_notified_at is 'Di-set saat notifikasi Telegram dikirim/dicoba → webhook duplikat tidak mengirim ulang.';

-- Index operasional
create index if not exists orders_account_idx  on public.orders (account_id, created_at desc);
create index if not exists orders_payment_id_idx on public.orders (payment_id) where payment_id is not null;
-- Antrian kerja penjual: order yang perlu diproses
create index if not exists orders_to_process_idx on public.orders (order_status, created_at asc)
  where order_status in ('PAID', 'PROCESSING');
-- Pembersihan order kadaluarsa
create index if not exists orders_pending_expiry_idx on public.orders (payment_expired_at)
  where payment_status = 'PENDING';
-- Antrian verifikasi pembayaran manual (klaim buyer yang belum diverifikasi)
create index if not exists orders_manual_claim_idx on public.orders (manual_claim_at asc)
  where manual_claim_at is not null and payment_status = 'PENDING';

-- unique payment_id (satu transaksi provider = satu order), boleh null
create unique index if not exists orders_payment_id_unique
  on public.orders (payment_id) where payment_id is not null;

-- ---------------------------------------------------------------------------
-- 2b. TABEL manual_payment_settings (SATU baris, id = 1)
--     Konfigurasi metode "Transfer Manual" — QRIS statis milik penjual
--     (mis. QR dari aplikasi GoPay Merchant) yang di-upload dari /admin/settings.
--
--     Gambar QR disimpan sebagai base64 agar tidak perlu bucket storage &
--     tidak perlu hosting eksternal. Dibatasi di aplikasi (maks ~900 KB).
--     Gambar disajikan ke buyer lewat GET /api/manual-qr (bukan data URI di
--     HTML, supaya halaman bayar tetap ringan & gambar bisa di-cache).
-- ---------------------------------------------------------------------------
create table if not exists public.manual_payment_settings (
  id              int primary key default 1 check (id = 1),
  is_enabled      boolean not null default true,
  label           text not null default 'Transfer Manual (QRIS)',
  account_name    text not null default '',   -- a.n. rekening/merchant, mis. "Toko Saya"
  instructions    text not null default '',   -- catatan tambahan utk buyer (opsional)
  expiry_minutes  int not null default 120 check (expiry_minutes between 10 and 4320),
  qr_image_mime   text not null default 'image/png',
  qr_image_base64 text,                       -- isi gambar (base64, tanpa prefix data:)
  qr_image_size   int not null default 0,     -- ukuran byte gambar asli (untk info admin)
  updated_at      timestamptz not null default now()
);

comment on table public.manual_payment_settings is
  'Konfigurasi pembayaran manual (QRIS statis penjual). Satu baris saja (id=1). Hanya service_role.';
comment on column public.manual_payment_settings.qr_image_base64 is
  'Gambar QR statis dalam base64. Di-upload dari /admin/settings; disajikan via /api/manual-qr.';

-- Baris default (idempotent) — tanpa baris ini metode manual dianggap belum dikonfigurasi.
insert into public.manual_payment_settings (id)
values (1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. updated_at otomatis (fungsi dibuat mandiri di project ini, agar
--    Supabase #2 bisa berdiri sendiri sesuai pemisahan 2 Supabase)
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists manual_payment_settings_set_updated_at on public.manual_payment_settings;
create trigger manual_payment_settings_set_updated_at
  before update on public.manual_payment_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.orders   enable row level security;
alter table public.manual_payment_settings enable row level security;

-- Produk: boleh DIBACA publik (anon & terautentikasi) bila aktif.
-- Menulis produk HANYA lewat server (service role, bypass RLS) yang sudah
-- memvalidasi role admin → tidak ada policy INSERT/UPDATE/DELETE di sini.
drop policy if exists "products_read_active" on public.products;
create policy "products_read_active"
  on public.products
  for select
  to anon, authenticated
  using (is_active = true);

-- Orders: RLS AKTIF TANPA policy apa pun = deny-by-default untuk anon &
-- authenticated. Membaca order milik user lain (atau order siapa pun) dari
-- browser adalah MUSTAHIL di level database; akses buyer & admin sepenuhnya
-- melalui API server-side yang memeriksa session + kepemilikan + role.
-- (service_role sengaja bypass RLS — key ini tidak pernah dikirim ke browser.)

-- manual_payment_settings: sama seperti orders — RLS tanpa policy. Gambar QR
-- dibaca server-side lalu disajikan lewat /api/manual-qr, jadi browser tidak
-- pernah menyentuh tabel ini langsung.

-- ============================================================================
-- SELESAI. Verifikasi cepat (SQL Editor):
--   select relname, relrowsecurity from pg_class
--   where relname in ('products','orders','manual_payment_settings');
--   -- true, true, true
--   select policyname from pg_policies where schemaname='public';
--   -- hanya "products_read_active"
--   select id, is_enabled, label from public.manual_payment_settings;  -- 1 baris
-- ============================================================================

-- ============================================================================
-- 5. MIGRASI LANJUTAN — SETELAH FILE INI, JALANKAN 002_manual_payment.sql
-- ============================================================================
-- Untuk project BARU, kolom pembayaran manual (payment_method, manual_*) dan
-- tabel manual_payment_settings sudah termasuk di CREATE TABLE di atas, jadi
-- tidak ada yang hilang.
--
-- Tetapi bila project #2 kamu PERNAH menjalankan 001_schema.sql VERSI LAMA
-- (sebelum fitur pembayaran manual ada), kolom-kolom itu BELUM ADA di database
-- dan aplikasi akan gagal dengan error Postgres 42703:
--     column orders.payment_method does not exist
-- Gejala di situs: dashboard /admin berubah jadi "Application error: a
-- server-side exception has occurred", dan checkout gagal membuat order.
--
-- Perbaikannya satu langkah: jalankan
--     supabase/store/002_manual_payment.sql
-- (idempotent — aman dijalankan berulang, tidak menghapus data), lalu muat
-- ulang schema cache PostgREST: `notify pgrst, 'reload schema';`
--
-- Urutan yang benar selalu: 001_schema.sql → 002_manual_payment.sql.
-- ============================================================================
