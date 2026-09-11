-- ============================================================================
-- SUPABASE #1 — ACCOUNT SYSTEM
-- Jalankan file ini di: Supabase Dashboard (Project #1) → SQL Editor → New query
-- ============================================================================
-- Berisi: tabel profiles, trigger pembuatan profil otomatis saat registrasi,
-- proteksi anti-escalation of privilege (role tidak bisa diubah oleh user),
-- RLS + policies.
-- TIDAK ada data dummy. Setelah dijalankan, database siap dipakai.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABEL profiles
--    Memetakan auth.users (Supabase Auth) → data profil buyer/admin.
--    Password & session TIDAK disimpan di sini; itu urusan Supabase Auth.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 80),
  email       text not null,
  whatsapp    text not null check (whatsapp ~ '^[0-9]{8,15}$'),
  -- Role authorization. HANYA boleh diubah oleh service_role / owner via SQL.
  -- Lihat trigger guard_profiles_role_change di bawah.
  role        text not null default 'buyer' check (role in ('buyer', 'admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Profil akun (buyer/admin). Data toko/transaksi TIDAK disimpan di project ini.';
comment on column public.profiles.whatsapp is
  'Nomor WhatsApp buyer dalam format 62xxxxxxxxxx (digit saja). Kontak pengiriman pesanan.';
comment on column public.profiles.role is
  'buyer | admin. Server-side authorization. Tidak dapat diubah oleh user biasa.';

create index if not exists profiles_email_idx on public.profiles (email);

-- ---------------------------------------------------------------------------
-- 2. updated_at otomatis
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

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Buat baris profiles otomatis saat user mendaftar (auth.users INSERT).
--    name & whatsapp dikirim dari form registrasi lewat user_metadata.
--    Email verification di-handle Supabase Auth; profil dibuat sejak awal
--    agar setelah klik link verifikasi, data sudah siap.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, whatsapp, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), 'Pengguna'),
    new.email,
    -- fallback agar constraint tidak gagal jika metadata kosong;
    -- API / form registrasi selalu mengirim nilai yang sudah ternormalisasi.
    coalesce(nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'whatsapp', ''), '[^0-9]', '', 'g'), ''), '00000000'),
    'buyer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Sinkronkan email profil bila email auth berubah.
create or replace function public.handle_user_email_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.handle_user_email_updated();

-- ---------------------------------------------------------------------------
-- 4. Proteksi role: user login biasa TIDAK boleh mengubah role sendiri.
--    service_role (API server) dan SQL editor owner (tanpa JWT) boleh.
--    Ini mencegah buyer menaikkan dirinya jadi admin lewat PATCH profil.
-- ---------------------------------------------------------------------------
create or replace function public.guard_profiles_role_change()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role then
    if coalesce(auth.role(), '') = 'authenticated' then
      raise exception 'Mengubah role tidak diizinkan'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role_change on public.profiles;
create trigger profiles_guard_role_change
  before update on public.profiles
  for each row execute function public.guard_profiles_role_change();

-- ---------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
--    Prinsip: default-deny. Buyer hanya menyentuh barisnya sendiri.
--    INSERT dilakukan oleh trigger security definer (bypass RLS) saat signup,
--    bukan oleh client. Tidak ada policy insert/update untuk anon.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- User yang login boleh membaca profilnya sendiri.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

-- User yang login boleh memperbaiki namanya sendiri & nomor WhatsApp-nya.
-- (Role tetap diblokir oleh trigger guard di atas; id tidak bisa diubah
--  karena policy hanya berlaku pada baris milik sendiri.)
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Tidak ada policy SELECT/UPDATE/INSERT/DELETE untuk role anon →
-- membaca/menulis profiles tanpa login akan selalu ditolak (42501/empty).

-- ============================================================================
-- SELESAI. Verifikasi cepat (SQL Editor):
--   select relrowsecurity from pg_class where relname = 'profiles';  -- true
-- ============================================================================
