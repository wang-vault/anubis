-- ============================================================================
-- SUPABASE #2 — MIGRASI: PROVIDER QRIS OTOMATIS YoBasePay → Stenly
-- Jalankan file ini di: Supabase Dashboard (Project #2) → SQL Editor → New query
-- ============================================================================
-- KAPAN FILE INI PERLU DIJALANKAN
--   * Project BARU  : jalankan 001_schema.sql lalu file ini (no-op, aman).
--   * Project LAMA  : WAJIB. Skema lama membatasi kolom `orders.payment_method`
--                     hanya ke ('YOBASEPAY', 'MANUAL'), sehingga order QRIS
--                     otomatis yang baru (payment_method = 'STENLY') DITOLAK
--                     database dengan error:
--                       new row for relation "orders" violates check
--                       constraint "orders_payment_method_check"
--                     Gejala di situs: checkout QRIS Otomatis gagal terus.
--
-- YANG DILAKUKAN FILE INI
--   1. Melonggarkan constraint payment_method agar menerima 'STENLY'.
--   2. Mengubah DEFAULT kolom menjadi 'STENLY'.
--
-- YANG **TIDAK** DILAKUKAN (disengaja)
--   * TIDAK mengubah satu pun baris order yang sudah ada.
--   * TIDAK menghapus/menulis ulang transaksi YoBasePay lama — nilai
--     payment_method = 'YOBASEPAY' tetap DIIZINKAN oleh constraint baru supaya
--     histori transaksi tetap valid dan tetap bisa dibaca dashboard.
--   * TIDAK menyentuh pembayaran manual (tetap berjalan seperti sebelumnya).
--
-- AMAN DIJALANKAN BERULANG (idempotent).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Constraint payment_method: tambahkan 'STENLY', pertahankan 'YOBASEPAY'
--    (untuk order lama) dan 'MANUAL'.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'orders_payment_method_check' and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders drop constraint orders_payment_method_check;
  end if;

  alter table public.orders
    add constraint orders_payment_method_check
    check (payment_method in ('STENLY', 'MANUAL', 'YOBASEPAY'));
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Default kolom untuk order BARU = STENLY.
--    (Aplikasi selalu mengirim nilai eksplisit; default ini hanya jaring
--     pengaman bila ada insert manual dari SQL Editor.)
-- ---------------------------------------------------------------------------
alter table public.orders
  alter column payment_method set default 'STENLY';

comment on column public.orders.payment_method is
  'STENLY = QRIS dinamis otomatis (provider aktif). MANUAL = QRIS statis penjual, diverifikasi manual. YOBASEPAY = provider lama, hanya pada order arsip (tidak pernah ditulis lagi).';

comment on column public.orders.payment_id is
  'ID transaksi di provider. Stenly memakai order_id yang kita kirim (= order_code). Order arsip berisi trx_id YoBasePay.';

-- Muat ulang schema cache PostgREST (aman dijalankan kapan pun).
notify pgrst, 'reload schema';

-- ============================================================================
-- SELESAI. Verifikasi cepat (SQL Editor):
--
--   -- constraint harus memuat STENLY, MANUAL, dan YOBASEPAY
--   select pg_get_constraintdef(oid)
--   from pg_constraint
--   where conname = 'orders_payment_method_check'
--     and conrelid = 'public.orders'::regclass;
--
--   -- order lama harus tetap utuh (tidak ada yang diubah)
--   select payment_method, payment_status, count(*)
--   from public.orders group by 1, 2 order by 1, 2;
-- ============================================================================
