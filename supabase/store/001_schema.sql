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
  -- Nominal final dari provider (total + kode unik YoBasePay, bila ada).
  -- Diisi saat createpayment / webhook / polling. Nullable untuk kompatibilitas.
  charged_amount        bigint check (charged_amount is null or charged_amount > 0),

  payment_status        text not null default 'PENDING'
    check (payment_status in ('PENDING', 'PAID', 'FAILED', 'EXPIRED')),
  order_status          text not null default 'PENDING'
    check (order_status in ('PENDING', 'PAID', 'PROCESSING', 'DONE', 'EXPIRED')),

  -- Informasi pembayaran (diisi server-side dari YoBasePay)
  payment_id            text,                          -- trx_id dari YoBasePay, mis. YO-ABC12345
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

-- unique payment_id (satu transaksi provider = satu order), boleh null
create unique index if not exists orders_payment_id_unique
  on public.orders (payment_id) where payment_id is not null;

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

-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.orders   enable row level security;

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

-- ============================================================================
-- SELESAI. Verifikasi cepat (SQL Editor):
--   select relname, relrowsecurity from pg_class
--   where relname in ('products','orders');                -- true, true
--   select policyname from pg_policies where schemaname='public';
--   -- hanya "products_read_active"
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 5. MIGRASI RINGAN (aman dijalankan ulang) — kolom charged_amount
--    Untuk project yang sudah menjalankan schema versi sebelumnya.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists charged_amount bigint;

comment on column public.orders.charged_amount is
  'Nominal final provider (total + kode unik). Sumber tampilan "Total transfer" di halaman bayar.';
