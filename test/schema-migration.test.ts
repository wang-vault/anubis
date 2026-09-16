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
import { BASE_ORDER_COLUMNS, MANUAL_ORDER_COLUMNS } from "@/lib/store-schema";

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
