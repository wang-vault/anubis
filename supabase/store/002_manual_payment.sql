-- ============================================================================
-- SUPABASE #2 — MIGRASI: PEMBAYARAN MANUAL (QRIS statis penjual)
-- Jalankan file ini di: Supabase Dashboard (Project #2) → SQL Editor → New query
-- ============================================================================
-- KAPAN FILE INI PERLU DIJALANKAN
--   * Project BARU           : jalankan 001_schema.sql lalu file ini (no-op).
--   * Project LAMA (sudah    : WAJIB. 001_schema.sql versi lama belum punya
--     pernah menjalankan       kolom pembayaran manual, sehingga aplikasi yang
--     001_schema.sql)          lebih baru gagal dengan error Postgres 42703:
--                                "column orders.payment_method does not exist"
--                              Gejala di situs: dashboard /admin berubah jadi
--                              "Application error: a server-side exception has
--                              occurred", dan checkout tidak bisa membuat order.
--
-- AMAN DIJALANKAN BERULANG: setiap statement pakai `if not exists` /
-- `on conflict do nothing` / `create or replace`, jadi tidak ada data yang
-- hilang bila file ini dijalankan dua kali.
--
-- CATATAN PROVIDER (2026-09): nilai 'YOBASEPAY' di bawah adalah nama provider
-- QRIS otomatis yang LAMA. File ini sengaja TIDAK diubah agar tetap setara
-- dengan riwayat migrasi yang sudah pernah dijalankan penjual. Provider
-- sekarang adalah Stenly: jalankan 003_stenly_payment.sql SETELAH file ini —
-- migrasi itu melonggarkan constraint menjadi ('STENLY','MANUAL','YOBASEPAY')
-- dan mengubah default kolom menjadi 'STENLY', tanpa menyentuh order lama.
--
-- SETELAH MENJALANKAN: muat ulang schema cache PostgREST agar API langsung
-- melihat kolom baru (biasanya otomatis, tapi jangan mengandalkan itu):
--   notify pgrst, 'reload schema';
-- (atau Dashboard → Project Settings → API → "Reload schema cache")
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Kolom tambahan di public.orders
--    payment_method : 'YOBASEPAY' = QRIS dinamis otomatis (provider lama;
--                                    diganti 'STENLY' oleh migrasi 003),
--                     'MANUAL'    = QRIS statis penjual, diverifikasi manual.
--    manual_*       : klaim buyer + hasil verifikasi penjual (server-side saja).
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists charged_amount bigint;

alter table public.orders
  add column if not exists payment_method text not null default 'YOBASEPAY';

alter table public.orders
  add column if not exists manual_claim_at timestamptz;

alter table public.orders
  add column if not exists manual_claim_note text not null default '';

alter table public.orders
  add column if not exists manual_claim_reference text not null default '';

alter table public.orders
  add column if not exists manual_claim_notified_at timestamptz;

alter table public.orders
  add column if not exists manual_reviewed_at timestamptz;

alter table public.orders
  add column if not exists manual_reviewed_by uuid;

alter table public.orders
  add column if not exists manual_review_status text;

alter table public.orders
  add column if not exists manual_review_note text not null default '';

comment on column public.orders.charged_amount is
  'Nominal final provider (total + kode unik). Sumber tampilan "Total transfer" di halaman bayar.';
comment on column public.orders.payment_method is
  'YOBASEPAY = QRIS dinamis otomatis. MANUAL = QRIS statis penjual, diverifikasi manual dari mutasi.';

-- ---------------------------------------------------------------------------
-- 2. Constraint nilai (hanya ditambah bila belum ada — idempotent)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_payment_method_check' and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_payment_method_check
      check (payment_method in ('YOBASEPAY', 'MANUAL'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_manual_review_status_check' and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_manual_review_status_check
      check (manual_review_status is null or manual_review_status in ('APPROVED', 'REJECTED'));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Tabel konfigurasi QRIS statis penjual (satu baris, id = 1)
--    Gambar QR disimpan base64 → tidak perlu bucket storage; disajikan ke
--    buyer lewat GET /api/manual-qr (di-upload dari /admin/settings).
-- ---------------------------------------------------------------------------
create table if not exists public.manual_payment_settings (
  id              int primary key default 1 check (id = 1),
  is_enabled      boolean not null default true,
  label           text not null default 'Transfer Manual (QRIS)',
  account_name    text not null default '',
  instructions    text not null default '',
  expiry_minutes  int not null default 120 check (expiry_minutes between 10 and 4320),
  qr_image_mime   text not null default 'image/png',
  qr_image_base64 text,
  qr_image_size   int not null default 0,
  updated_at      timestamptz not null default now()
);

comment on table public.manual_payment_settings is
  'Konfigurasi pembayaran manual (QRIS statis penjual). Satu baris saja (id=1). Hanya service_role.';
comment on column public.manual_payment_settings.qr_image_base64 is
  'Gambar QR statis dalam base64. Di-upload dari /admin/settings; disajikan via /api/manual-qr.';

-- Baris default (idempotent) — tanpa baris ini metode manual dianggap belum
-- dikonfigurasi penjual.
insert into public.manual_payment_settings (id)
values (1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Trigger updated_at (fungsi dibuat mandiri agar project #2 berdiri sendiri)
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

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists manual_payment_settings_set_updated_at on public.manual_payment_settings;
create trigger manual_payment_settings_set_updated_at
  before update on public.manual_payment_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. RLS + index
--    orders & manual_payment_settings = deny-by-default (RLS aktif tanpa
--    policy): hanya service_role (server-side) yang boleh menyentuhnya.
-- ---------------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.manual_payment_settings enable row level security;

-- Antrian verifikasi pembayaran manual (klaim buyer yang belum diverifikasi)
create index if not exists orders_manual_claim_idx on public.orders (manual_claim_at asc)
  where manual_claim_at is not null and payment_status = 'PENDING';

-- Muat ulang schema cache PostgREST (aman dijalankan kapan pun).
notify pgrst, 'reload schema';

-- ============================================================================
-- SELESAI. Verifikasi cepat (SQL Editor) — harus menampilkan 10 baris:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'orders'
--     and column_name in (
--       'charged_amount','payment_method','manual_claim_at','manual_claim_note',
--       'manual_claim_reference','manual_claim_notified_at','manual_reviewed_at',
--       'manual_reviewed_by','manual_review_status','manual_review_note'
--     )
--   order by column_name;
--
--   select id, is_enabled, label from public.manual_payment_settings;  -- 1 baris
-- ============================================================================
