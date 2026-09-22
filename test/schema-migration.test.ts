/**
 * Penjaga keselarasan skema: daftar kolom di kode TIDAK BOLEH melenceng dari
 * `supabase/store/001_schema.sql`.
 *
 * Kenapa penting: `BASE_ORDER_COLUMNS` dipakai sebagai daftar kolom eksplisit
 * saat `select("*")` ditolak database (skema belum di-migrasi / schema cache
 * PostgREST basi). Bila ada kolom baru di SQL tapi tidak masuk daftar itu,
 * baris order akan kehilangan field secara diam-diam.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BASE_ORDER_COLUMNS,
  MANUAL_ORDER_COLUMNS,
  MANUAL_SETTINGS_COLUMNS,
  WHATSAPP_PAYMENT_MIGRATION_FILE,
  WHATSAPP_PAYMENT_MIGRATION_SQL,
} from "@/lib/store-schema";

const SQL_KEYWORDS = [
  "check",
  "primary",
  "unique",
  "foreign",
  "constraint",
  "references",
  // kelanjutan ekspresi CHECK multi-baris
  "or",
  "and",
  "not",
  "null",
];

/** Nama kolom dari blok `create table … public.orders ( … );` di 001_schema.sql. */
function orderColumnsFromSchema(): string[] {
  const sql = readFileSync(
    fileURLToPath(new URL("../supabase/store/001_schema.sql", import.meta.url)),
    "utf-8",
  );
  const start = sql.indexOf("create table if not exists public.orders (");
  expect(start, "blok create table orders tidak ditemukan").toBeGreaterThan(-1);
  const end = sql.indexOf("\n);", start);
  const block = sql.slice(start, end);

  const cols: string[] = [];
  for (const rawLine of block.split("\n").slice(1)) {
    const line = rawLine.replace(/--.*$/, "").trim();
    const match = /^([a-z_][a-z0-9_]*)\s/.exec(line);
    if (!match) continue;
    const name = match[1] as string;
    if (SQL_KEYWORDS.includes(name)) continue;
    cols.push(name);
  }
  return cols;
}

describe("BASE_ORDER_COLUMNS vs 001_schema.sql", () => {
  const inSql = orderColumnsFromSchema();
  const inCode: string[] = [...new Set<string>([...BASE_ORDER_COLUMNS, ...MANUAL_ORDER_COLUMNS])];

  it("parser menemukan kolom tabel orders (sanity check parser)", () => {
    expect(inSql.length).toBeGreaterThan(25);
    expect(inSql).toContain("order_code");
    expect(inSql).toContain("payment_method");
    expect(inSql).toContain("updated_at");
    expect(inSql).not.toContain("check");
  });

  it("setiap kolom orders di SQL tercakup daftar kolom di kode", () => {
    const missingInCode = inSql.filter((c) => !inCode.includes(c));
    expect(missingInCode).toEqual([]);
  });

  it("tidak ada kolom di kode yang tidak dikenal SQL", () => {
    const ghostInCode = inCode.filter((c) => !inSql.includes(c));
    expect(ghostInCode).toEqual([]);
  });

  it("kolom dasar tidak memuat kolom pembayaran manual (kecuali charged_amount)", () => {
    const overlap = BASE_ORDER_COLUMNS.filter((c) =>
      (MANUAL_ORDER_COLUMNS as readonly string[]).includes(c),
    );
    expect(overlap).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
/**
 * Migrasi WhatsApp (004): SQL yang ditempel penjual dari banner /admin harus
 * setara dengan file di repo. Kalau keduanya melenceng, penjual bisa menambah
 * kolom versi lain dari yang diharapkan kode (mis. nomor WhatsApp tersimpan
 * tapi tetap dianggap "belum diatur").
 */
describe("WHATSAPP_PAYMENT_MIGRATION_SQL vs 004_whatsapp_payment.sql", () => {
  const sqlFile = readFileSync(
    fileURLToPath(new URL("../supabase/store/004_whatsapp_payment.sql", import.meta.url)),
    "utf-8",
  );

  it("nama file yang disebut kode = file yang ada di repo", () => {
    expect(WHATSAPP_PAYMENT_MIGRATION_FILE).toBe("supabase/store/004_whatsapp_payment.sql");
    expect(sqlFile).toContain("AMAN DIJALANKAN BERULANG");
  });

  it("keduanya menambah kolom WA, menjadikan MANUAL default, dan mereload schema cache", () => {
    for (const sql of [WHATSAPP_PAYMENT_MIGRATION_SQL, sqlFile]) {
      for (const col of MANUAL_SETTINGS_COLUMNS) {
        expect(sql, `SQL tidak menambah kolom ${col}`).toContain(
          `add column if not exists ${col}`,
        );
      }
      expect(sql).toContain("alter column payment_method set default 'MANUAL'");
      // Label default lama ("Transfer Manual (QRIS)") hanya dirapikan bila
      // memang masih default — label buatan penjual tidak boleh ditimpa.
      expect(sql).toContain("alter column label set default 'Transfer Manual (WhatsApp)'");
      expect(sql).toContain("where id = 1 and label = 'Transfer Manual (QRIS)'");
      expect(sql).toContain("notify pgrst, 'reload schema'");
    }
  });

  /**
   * Order YoBasePay/Stenly lama HARUS tetap valid & tidak tersentuh. Migrasi
   * yang menulis ulang baris order (update/delete) akan merusak histori
   * transaksi; menghapus nilai lama dari CHECK akan membuat baris itu ditolak
   * saat dibaca ulang.
   */
  it("nilai arsip tetap diizinkan & tidak ada baris order yang ditulis ulang", () => {
    const statements = sqlFile
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .toLowerCase();

    expect(statements).not.toMatch(/\bupdate\s+public\.orders\b/);
    expect(statements).not.toMatch(/\bdelete\s+from\b/);
    expect(statements).not.toMatch(/\bdrop\s+table\b/);
    expect(statements).not.toMatch(/\bdrop\s+column\b/);
    expect(statements).not.toMatch(/\btruncate\b/);
    // 'STENLY'/'YOBASEPAY' tetap diizinkan constraint baru → order arsip tetap terbaca.
    expect(statements).toContain("'stenly'");
    expect(statements).toContain("'yobasepay'");
    expect(statements).toContain("check (payment_method in ('manual', 'stenly', 'yobasepay'))");
  });

  it("001_schema.sql (project baru) sudah memakai default & kolom yang sama", () => {
    const base = readFileSync(
      fileURLToPath(new URL("../supabase/store/001_schema.sql", import.meta.url)),
      "utf-8",
    );
    expect(base).toContain("default 'MANUAL'");
    expect(base).toMatch(/payment_method\s+in\s*\(\s*'MANUAL',\s*'STENLY',\s*'YOBASEPAY'\s*\)/);
    for (const col of MANUAL_SETTINGS_COLUMNS) {
      expect(base, `001_schema.sql tidak memuat kolom ${col}`).toContain(col);
    }
    // Satu-satunya label default metode = versi WhatsApp (bukan QRIS).
    expect(base).not.toContain("Transfer Manual (QRIS)");
  });
});
