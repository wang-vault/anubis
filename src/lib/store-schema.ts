import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/logger";
import { storeDb } from "@/lib/supabase/server";
import { PAYMENT_METHOD_AUTO } from "@/lib/payment-methods";
import type { OrderRow } from "@/lib/types";

/**
 * ===========================================================================
 * KESELARASAN SKEMA STORE (Supabase #2) — penjaga "kode lebih baru dari DB"
 * ===========================================================================
 * Yang terjadi di produksi: penjual menjalankan `001_schema.sql` versi lama,
 * lalu fitur pembayaran manual dirilis. Query apa pun yang menyentuh kolom
 * `orders.payment_method` / `manual_*` ditolak Postgres dengan SQLSTATE 42703
 * ("column orders.payment_method does not exist"). Tanpa penanganan, satu
 * query yang gagal itu menjatuhkan SELURUH halaman — dashboard /admin berubah
 * menjadi "Application error: a server-side exception has occurred".
 *
 * Modul ini melakukan tiga hal:
 *  1. MEMERIKSA (sekali per instance, di-cache 60 detik) apakah kolom
 *     pembayaran manual benar-benar ada di database → `checkStoreSchema()`.
 *  2. Mengenali error "kolom/tabel tidak ada" → `isMissingColumnError()`,
 *     supaya pemanggil bisa fallback alih-alih melempar 500.
 *  3. Menormalkan baris order → `normalizeOrderRow()`, supaya kolom yang
 *     belum ada (undefined) menjadi nilai default yang aman bagi UI.
 *
 * PENTING: ini BUKAN pengganti migrasi. Pembayaran manual tetap non-aktif
 * sampai penjual menjalankan `supabase/store/002_manual_payment.sql`
 * (SQL-nya ikut ditampilkan di banner /admin lewat MANUAL_PAYMENT_MIGRATION_SQL).
 * Tujuan modul ini hanya satu: situs tidak mati total sementara menunggu.
 */

/** SQLSTATE Postgres: kolom tidak ada. */
export const PG_UNDEFINED_COLUMN = "42703";
/** SQLSTATE Postgres: baris melanggar CHECK constraint. */
export const PG_CHECK_VIOLATION = "23514";
/** SQLSTATE Postgres: tabel tidak ada. */
export const PG_UNDEFINED_TABLE = "42P01";
/** Kode PostgREST: kolom tidak ada di schema cache. */
export const PGRST_MISSING_COLUMN = "PGRST204";
/** Kode PostgREST: tabel tidak ada di schema cache. */
export const PGRST_MISSING_TABLE = "PGRST205";

/** Bentuk minimal error PostgREST/Supabase yang kita periksa. */
export interface PostgrestErrorLike {
  message?: string | null;
  code?: string | null;
}

/** Kolom pembayaran manual yang ditambahkan migrasi 002_manual_payment.sql. */
export const MANUAL_ORDER_COLUMNS = [
  "charged_amount",
  "payment_method",
  "manual_claim_at",
  "manual_claim_note",
  "manual_claim_reference",
  "manual_claim_notified_at",
  "manual_reviewed_at",
  "manual_reviewed_by",
  "manual_review_status",
  "manual_review_note",
] as const;

/** Nama file migrasi yang harus dijalankan penjual (disebut di log & banner). */
export const MANUAL_PAYMENT_MIGRATION_FILE = "supabase/store/002_manual_payment.sql";

/**
 * Migrasi provider pembayaran otomatis YoBasePay → Stenly.
 *
 * Skema lama membatasi `orders.payment_method` ke ('YOBASEPAY','MANUAL'),
 * sehingga order QRIS otomatis yang baru (nilai 'STENLY') ditolak database
 * dengan SQLSTATE 23514. File ini melonggarkan constraint tersebut TANPA
 * mengubah satu pun baris order lama.
 */
export const STENLY_MIGRATION_FILE = "supabase/store/003_stenly_payment.sql";

/**
 * SQL minimal migrasi Stenly — ditampilkan apa adanya ke penjual bila checkout
 * QRIS otomatis ditolak constraint lama. Setara dengan STENLY_MIGRATION_FILE
 * (dijaga test/schema-migration.test.ts).
 */
export const STENLY_MIGRATION_SQL = `do $$
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

alter table public.orders
  alter column payment_method set default 'STENLY';

notify pgrst, 'reload schema';`;

/**
 * Kolom `orders` yang sudah ada sejak skema awal (SEBELUM migrasi 002).
 *
 * Dipakai sebagai daftar kolom eksplisit saat `select("*")` ditolak karena
 * skema tidak cocok. Kenapa `*` bisa ditolak: PostgREST me-resolve `*` dari
 * schema cache-nya, jadi bila cache menyebut kolom yang TIDAK ADA di tabel
 * (mis. database di-restore, atau kolom dihapus setelah migrasi), Postgres
 * membalas `42703 column orders.payment_method does not exist` — persis error
 * yang menjatuhkan /admin di produksi. Daftar eksplisit di bawah tidak
 * menyebut kolom migrasi, jadi query tetap jalan.
 *
 * `charged_amount` sengaja TIDAK ikut (baru ada sejak migrasi §5); bila kolom
 * itu hilang, `normalizeOrderRow()` mengisinya null.
 * Keselarasan dengan 001_schema.sql dijaga test/schema-migration.test.ts.
 */
export const BASE_ORDER_COLUMNS = [
  "id",
  "order_code",
  "account_id",
  "product_id",
  "product_name_snapshot",
  "unit_price_snapshot",
  "quantity",
  "total_amount",
  "payment_status",
  "order_status",
  "payment_id",
  "payment_url",
  "qr_image_url",
  "payment_expired_at",
  "last_payment_checked_at",
  "paid_at",
  "telegram_notified_at",
  "buyer_name_snapshot",
  "buyer_whatsapp_snapshot",
  "buyer_email_snapshot",
  "created_at",
  "updated_at",
] as const;

/** Daftar kolom eksplisit versi aman (tanpa kolom pembayaran manual). */
export const BASE_ORDER_SELECT = BASE_ORDER_COLUMNS.join(",");

/**
 * SQL minimal yang memperbaiki error 42703 — ditampilkan apa adanya di banner
 * /admin supaya penjual bisa menempelkannya ke Supabase SQL Editor tanpa
 * membuka repository. Isinya HARUS setara dengan MANUAL_PAYMENT_MIGRATION_FILE
 * (dijaga oleh test/schema-migration.test.ts).
 */
export const MANUAL_PAYMENT_MIGRATION_SQL = `alter table public.orders
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
insert into public.manual_payment_settings (id) values (1) on conflict (id) do nothing;
alter table public.manual_payment_settings enable row level security;

create index if not exists orders_manual_claim_idx on public.orders (manual_claim_at asc)
  where manual_claim_at is not null and payment_status = 'PENDING';

notify pgrst, 'reload schema';`;

function matches(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

/** Error "kolom tidak ada" — baik dari Postgres (42703) maupun PostgREST. */
export function isMissingColumnError(err: PostgrestErrorLike | null | undefined): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  if (code === PG_UNDEFINED_COLUMN || code === PGRST_MISSING_COLUMN) return true;
  return matches(err.message ?? "", /column .*does not exist/i)
    || matches(err.message ?? "", /could not find the .* column/i);
}

/**
 * Error "nilai payment_method ditolak CHECK constraint" — penanda database
 * masih memakai constraint lama yang belum mengenal 'STENLY'.
 */
export function isPaymentMethodConstraintError(
  err: PostgrestErrorLike | null | undefined,
): boolean {
  if (!err) return false;
  if ((err.code ?? "") !== PG_CHECK_VIOLATION) return false;
  return matches(err.message ?? "", /orders_payment_method_check|payment_method/i);
}

/** Error "tabel tidak ada" (schema #2 belum dijalankan sama sekali). */
export function isMissingTableError(err: PostgrestErrorLike | null | undefined): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  if (code === PG_UNDEFINED_TABLE || code === PGRST_MISSING_TABLE) return true;
  return matches(err.message ?? "", /relation .*does not exist/i)
    || matches(err.message ?? "", /could not find the table/i);
}

/** Salah satu dari dua di atas: skema DB tidak cocok dengan kode aplikasi. */
export function isSchemaMismatchError(err: PostgrestErrorLike | null | undefined): boolean {
  return isMissingColumnError(err) || isMissingTableError(err);
}

/**
 * Pesan error yang layak masuk log.
 *
 * Query `count` memakai request HEAD (head: true), dan respons HEAD TIDAK
 * punya body → @supabase/postgrest-js mengisi `error.message` dengan string
 * kosong. Itulah asal baris log membingungkan `"admin_stats_failed","message":""`.
 * Tanpa pesan, sebutkan alasannya + kode error bila ada, supaya log tetap
 * bisa dipakai mendiagnosa.
 */
export function describeDbError(err: PostgrestErrorLike | null | undefined): string {
  const message = err?.message?.trim();
  if (message) return message;
  const code = err?.code?.trim();
  return code
    ? `(tanpa pesan dari server — kode ${code})`
    : "(tanpa pesan: request HEAD tidak memuat body error)";
}

export type StoreSchemaReason = "ok" | "missing_column" | "missing_table" | "unknown";

export interface StoreSchemaCheck {
  /** Kolom pembayaran manual ada & bisa dipakai. */
  ready: boolean;
  reason: StoreSchemaReason;
  /** Pesan asli dari database (untuk log & banner admin). */
  message: string | null;
  checkedAt: string;
}

/** Umur cache hasil probe: cukup singkat agar situs pulih tanpa redeploy. */
export const SCHEMA_CACHE_TTL_MS = 60_000;

let cachedCheck: { value: StoreSchemaCheck; expiresAt: number } | null = null;
let pendingCheck: Promise<StoreSchemaCheck> | null = null;
let announcedOutdated = false;

/** Buang cache (dipakai setelah migrasi dijalankan, dan di unit test). */
export function resetStoreSchemaCache(): void {
  cachedCheck = null;
  pendingCheck = null;
}

async function runStoreSchemaCheck(db: SupabaseClient): Promise<StoreSchemaCheck> {
  const checkedAt = new Date().toISOString();
  const { error } = await db
    .from("orders")
    // Satu query ringan: hanya memastikan semua kolom manual benar-benar ada.
    // limit(1) → tanpa body besar; tanpa filter → tidak butuh baris data.
    .select(MANUAL_ORDER_COLUMNS.join(","))
    .limit(1);

  if (!error) {
    return { ready: true, reason: "ok", message: null, checkedAt };
  }
  if (isMissingTableError(error)) {
    return { ready: false, reason: "missing_table", message: error.message ?? null, checkedAt };
  }
  if (isMissingColumnError(error)) {
    return { ready: false, reason: "missing_column", message: error.message ?? null, checkedAt };
  }
  // Error lain (jaringan, RLS, dsb): jangan simpulkan skema basi.
  return { ready: true, reason: "unknown", message: error.message ?? null, checkedAt };
}

/**
 * Periksa skema store. Hasil di-cache SCHEMA_CACHE_TTL_MS per instance, jadi
 * dashboard tidak menambah satu query per render — tetapi tetap pulih sendiri
 * ≤1 menit setelah penjual menjalankan migrasi (tanpa perlu redeploy).
 *
 * `client` opsional untuk test/migrasi eksplisit: bila diisi, cache dilewati.
 */
export async function checkStoreSchema(client?: SupabaseClient): Promise<StoreSchemaCheck> {
  if (client) return runStoreSchemaCheck(client);

  if (cachedCheck && cachedCheck.expiresAt > Date.now()) return cachedCheck.value;
  if (!pendingCheck) {
    pendingCheck = (async () => {
      const value = await runStoreSchemaCheck(await storeDb());
      cachedCheck = { value, expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS };
      return value;
    })();
    // Jangan biarkan satu kegagalan jaringan menahan pemeriksaan berikutnya.
    void pendingCheck.catch(() => {
      pendingCheck = null;
    });
  }

  const check = await pendingCheck;
  pendingCheck = null;

  if (!check.ready && !announcedOutdated) {
    announcedOutdated = true;
    log.warn("store_schema_outdated", {
      reason: check.reason,
      message: check.message,
      hint: `Jalankan ${MANUAL_PAYMENT_MIGRATION_FILE} di Supabase #2 → SQL Editor, lalu reload schema cache.`,
    });
  }
  return check;
}

/** Pembayaran manual bisa dipakai? (kolomnya ada di database) */
export async function isManualPaymentSchemaReady(): Promise<boolean> {
  return (await checkStoreSchema()).ready;
}

/**
 * Nilai default untuk kolom pembayaran manual. Dipakai saat database belum
 * di-migrasi: PostgREST mengembalikan baris TANPA field itu (undefined), dan
 * UI (mis. `order.manual_claim_note`) tidak boleh membaca undefined.
 */
export const ORDER_ROW_DEFAULTS = {
  charged_amount: null,
  payment_method: PAYMENT_METHOD_AUTO,
  manual_claim_at: null,
  manual_claim_note: "",
  manual_claim_reference: "",
  manual_claim_notified_at: null,
  manual_reviewed_at: null,
  manual_reviewed_by: null,
  manual_review_status: null,
  manual_review_note: "",
} as const satisfies Partial<Record<keyof OrderRow, unknown>>;

/**
 * Isi kolom pembayaran manual yang hilang dengan default aman.
 * Idempotent & tidak menimpa nilai yang sudah ada (termasuk null eksplisit).
 */
export function normalizeOrderRow<T extends object>(row: T): T {
  const out = { ...row } as Record<string, unknown>;
  for (const [key, value] of Object.entries(ORDER_ROW_DEFAULTS)) {
    if (out[key] === undefined) out[key] = value;
  }
  return out as T;
}
