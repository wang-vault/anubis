-- ============================================================================
-- SUPABASE #2 — MIGRASI: PEMBAYARAN MANUAL VIA WHATSAPP
-- Jalankan file ini di: Supabase Dashboard (Project #2) → SQL Editor → New query
-- ============================================================================
-- KAPAN FILE INI PERLU DIJALANKAN
--   * Project BARU  : 001_schema.sql sudah memuat semua kolom di bawah → file
--                     ini no-op (aman dijalankan, tidak mengubah apa pun).
--   * Project LAMA  : WAJIB. Tanpa migrasi ini, penjual tidak bisa menyimpan
--                     nomor WhatsApp (error Postgres 42703:
--                     "column manual_payment_settings.whatsapp_number does not
--                     exist"), sehingga checkout berkata "pembayaran belum
--                     tersedia". Banner merah di /admin memuat SQL ini.
--
-- YANG DILAKUKAN FILE INI
--   1. Menambah kolom nomor WhatsApp penjual + template pesan buyer→penjual.
--   2. Menjadikan 'MANUAL' sebagai default kolom orders.payment_method.
--   3. Merapikan label default metode (masih "Transfer Manual (QRIS)" di
--      database lama) — hanya bila labelnya memang masih default.
--
-- YANG **TIDAK** DILAKUKAN (disengaja)
--   * TIDAK mengubah/menghapus satu pun baris order yang sudah ada.
--   * TIDAK menghapus kolom qr_image_* warisan (QR statis dulu ditampilkan di
--     aplikasi). Sekarang pembayaran dikirim penjual lewat chat WhatsApp, jadi
--     kolom itu tidak dipakai — dibiarkan ada agar data lama tidak hilang.
--   3. Merapikan label default yang masih bernilai "Transfer Manual (QRIS)"
--      dari migrasi 002 — hanya bila labelnya memang masih default (label
--      yang sudah kamu ubah sendiri tidak disentuh).
--
-- YANG **TIDAK** DILAKUKAN (disengaja)
--   * TIDAK menyentuh constraint lama yang masih mengizinkan nilai arsip
--     'STENLY' / 'YOBASEPAY' — order dari masa QRIS otomatis harus tetap valid
--     dibaca dashboard.
--
-- AMAN DIJALANKAN BERULANG (idempotent).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Kolom konfigurasi WhatsApp di manual_payment_settings
-- ---------------------------------------------------------------------------
alter table public.manual_payment_settings
  add column if not exists whatsapp_number text not null default '';

alter table public.manual_payment_settings
  add column if not exists whatsapp_message_template text not null default '';

comment on column public.manual_payment_settings.whatsapp_number is
  'Nomor WhatsApp penjual (62…) — tujuan chat buyer dari halaman pembayaran.';

comment on column public.manual_payment_settings.whatsapp_message_template is
  'Template pesan buyer→penjual. Placeholder: {toko} {kode} {produk} {jumlah} {total} {nama}.';

-- ---------------------------------------------------------------------------
-- 2. Default metode bayar untuk order BARU = MANUAL (satu-satunya metode).
--    Nilai arsip 'STENLY' / 'YOBASEPAY' tetap diizinkan constraint.
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
    check (payment_method in ('MANUAL', 'STENLY', 'YOBASEPAY'));
end
$$;

alter table public.orders
  alter column payment_method set default 'MANUAL';

comment on column public.orders.payment_method is
  'MANUAL = transfer manual yang dikoordinasikan lewat WhatsApp (satu-satunya metode untuk order baru). STENLY/YOBASEPAY = provider QRIS otomatis lama, hanya pada order arsip (tidak pernah ditulis lagi).';

-- ---------------------------------------------------------------------------
-- 3. Rapikan label default (hanya bila masih nilai default lama).
-- ---------------------------------------------------------------------------
alter table public.manual_payment_settings
  alter column label set default 'Transfer Manual (WhatsApp)';

update public.manual_payment_settings
  set label = 'Transfer Manual (WhatsApp)'
  where id = 1 and label = 'Transfer Manual (QRIS)';

-- Muat ulang schema cache PostgREST (aman dijalankan kapan pun).
notify pgrst, 'reload schema';

-- ============================================================================
-- SELESAI. Verifikasi cepat (SQL Editor):
--
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'manual_payment_settings'
--     and column_name in ('whatsapp_number','whatsapp_message_template');
--
--   select payment_method, payment_status, count(*)
--   from public.orders group by 1, 2 order by 1, 2;   -- order lama tetap utuh
-- ============================================================================
