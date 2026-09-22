/**
 * Unit test PENJAGA SKEMA STORE (lib/store-schema).
 *
 * Latar belakang bug produksi: database Supabase #2 belum punya kolom
 * `orders.payment_method`, sehingga query dashboard admin gagal dengan
 * SQLSTATE 42703 ("column orders.payment_method does not exist") dan seluruh
 * halaman /admin berubah menjadi "Application error". Test di bawah mengunci
 * deteksi error itu, normalisasi baris, probe skema (+cache), dan isi SQL
 * migrasi yang ditampilkan ke penjual.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type Row } from "./helpers/fake-store";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
}));

vi.mock("@/lib/supabase/server", () => ({
  storeDb: async () => h.db,
}));

import type { OrderRow } from "@/lib/types";
import {
  MANUAL_ORDER_COLUMNS,
  MANUAL_PAYMENT_MIGRATION_FILE,
  MANUAL_PAYMENT_MIGRATION_SQL,
  checkStoreSchema,
  describeDbError,
  isManualPaymentSchemaReady,
  isMissingColumnError,
  isMissingTableError,
  isSchemaMismatchError,
  normalizeOrderRow,
  resetStoreSchemaCache,
} from "@/lib/store-schema";

/** Kolom pembayaran manual di luar charged_amount (yang sudah ada lebih dulu). */
const MANUAL_ONLY_COLUMNS = MANUAL_ORDER_COLUMNS.filter((c) => c !== "charged_amount");

type StoreClient = Parameters<typeof checkStoreSchema>[0];

/** Fake Supabase dipakai sebagai klien (hanya .from() yang dipakai probe). */
function asClient(db: ReturnType<typeof createFakeDb>): StoreClient {
  return db as unknown as StoreClient;
}

function healthyDb() {
  return createFakeDb({ orders: [{ id: "x", payment_method: "MANUAL" }] });
}

/** Database "lama": semua kolom pembayaran manual belum ada. */
function outdatedDb() {
  return createFakeDb({ orders: [{ id: "x" }] }, { missingColumns: { orders: [...MANUAL_ONLY_COLUMNS] } });
}

beforeEach(() => {
  resetStoreSchemaCache();
});

// ---------------------------------------------------------------------------
describe("deteksi error skema", () => {
  it("mengenali 42703 dari Postgres (pesan yang muncul di log produksi)", () => {
    expect(
      isMissingColumnError({
        code: "42703",
        message: "column orders.payment_method does not exist",
      }),
    ).toBe(true);
  });

  it("mengenali 42703 tanpa kode (respons HEAD tidak memuat body/kode)", () => {
    expect(isMissingColumnError({ message: "column orders.payment_method does not exist" })).toBe(true);
  });

  it("mengenali PGRST204 (kolom tidak ada di schema cache PostgREST)", () => {
    expect(
      isMissingColumnError({
        code: "PGRST204",
        message: "Could not find the 'payment_method' column of 'orders' in the schema cache",
      }),
    ).toBe(true);
  });

  it("TIDAK menganggap error lain sebagai masalah skema", () => {
    expect(isMissingColumnError({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isMissingColumnError({ code: "PGRST116", message: "no rows" })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError(undefined)).toBe(false);
  });

  it("membedakan kolom hilang vs tabel hilang", () => {
    expect(isMissingTableError({ code: "42P01", message: "relation 'public.orders' does not exist" })).toBe(true);
    expect(isMissingTableError({ message: "relation \"public.orders\" does not exist" })).toBe(true);
    expect(isMissingTableError({ code: "42703", message: "column orders.x does not exist" })).toBe(false);

    expect(isSchemaMismatchError({ code: "42703", message: "column orders.x does not exist" })).toBe(true);
    expect(isSchemaMismatchError({ code: "42P01", message: "relation 'public.orders' does not exist" })).toBe(true);
    expect(isSchemaMismatchError({ code: "23505", message: "duplicate key" })).toBe(false);
  });

  it("describeDbError menjelaskan pesan kosong dari query count (HEAD)", () => {
    // Inilah asal baris log membingungkan: "admin_stats_failed","message":""
    expect(describeDbError({ message: "" })).toMatch(/tanpa pesan/);
    expect(describeDbError({ message: "", code: "42703" })).toContain("42703");
    expect(describeDbError({ message: "  " })).toMatch(/HEAD/);
    expect(describeDbError({ message: "column orders.payment_method does not exist" })).toBe(
      "column orders.payment_method does not exist",
    );
  });
});

// ---------------------------------------------------------------------------
describe("normalizeOrderRow — baris dari database yang belum di-migrasi", () => {
  it("mengisi kolom manual yang hilang dengan default aman", () => {
    const row: Partial<OrderRow> = { id: "1", order_code: "ORD-1", payment_status: "PENDING" };
    const out = normalizeOrderRow(row);

    expect(out.payment_method).toBe("MANUAL");
    expect(out.manual_claim_at).toBeNull();
    expect(out.manual_claim_note).toBe("");
    expect(out.manual_claim_reference).toBe("");
    expect(out.manual_review_status).toBeNull();
    expect(out.manual_review_note).toBe("");
    expect(out.charged_amount).toBeNull();
    // field asli tidak disentuh
    expect(out.order_code).toBe("ORD-1");
  });

  it("tidak menimpa nilai yang sudah ada (termasuk null eksplisit)", () => {
    const row: Partial<OrderRow> = {
      payment_method: "MANUAL",
      manual_claim_note: "Budi",
      manual_review_status: "APPROVED",
      charged_amount: 50417,
      manual_claim_at: null,
    };
    const out = normalizeOrderRow(row);

    expect(out.payment_method).toBe("MANUAL");
    expect(out.manual_claim_note).toBe("Budi");
    expect(out.manual_review_status).toBe("APPROVED");
    expect(out.charged_amount).toBe(50417);
    expect(out.manual_claim_at).toBeNull();
  });

  it("idempotent dan tidak memutasi input", () => {
    const row: Row = { id: "1" };
    const first = normalizeOrderRow(row);
    const second = normalizeOrderRow(first);

    expect(row).toEqual({ id: "1" });
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
describe("checkStoreSchema — probe kolom pembayaran manual", () => {
  it("ready=true bila semua kolom ada", async () => {
    h.db = healthyDb();
    const check = await checkStoreSchema(asClient(h.db));
    expect(check).toMatchObject({ ready: true, reason: "ok" });
    expect(await isManualPaymentSchemaReady()).toBe(true);
  });

  it("ready=false + alasan missing_column bila kolom belum di-migrasi", async () => {
    const check = await checkStoreSchema(asClient(outdatedDb()));

    expect(check.ready).toBe(false);
    expect(check.reason).toBe("missing_column");
    expect(check.message).toMatch(/payment_method/);
  });

  it("ready=false + alasan missing_table bila tabel orders belum ada", async () => {
    const db = createFakeDb({}, { missingTables: ["orders"] });
    const check = await checkStoreSchema(asClient(db));

    expect(check.ready).toBe(false);
    expect(check.reason).toBe("missing_table");
  });

  it("error non-skema (mis. jaringan) tidak dianggap skema basi", async () => {
    const probe = {
      select: () => probe,
      limit: () => Promise.resolve({ data: null, error: { message: "fetch failed" } }),
    };
    const fake = { from: () => probe } as unknown as Parameters<typeof checkStoreSchema>[0];

    const check = await checkStoreSchema(fake);

    expect(check).toMatchObject({ ready: true, reason: "unknown", message: "fetch failed" });
  });

  it("hasil di-cache, dan pulih setelah resetStoreSchemaCache()", async () => {
    h.db = outdatedDb();
    expect(await isManualPaymentSchemaReady()).toBe(false);

    // Penjual menjalankan migrasi — instance masih memegang cache lama.
    h.db = healthyDb();
    expect(await isManualPaymentSchemaReady()).toBe(false);

    // Cache kedaluwarsa/dibuang → probe ulang melihat kolom yang sudah ada.
    resetStoreSchemaCache();
    expect(await isManualPaymentSchemaReady()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("SQL migrasi yang ditampilkan ke penjual", () => {
  const sqlFile = readFileSync(
    fileURLToPath(new URL("../supabase/store/002_manual_payment.sql", import.meta.url)),
    "utf-8",
  );

  it("menambahkan SEMUA kolom pembayaran manual (banner & file tidak boleh melenceng)", () => {
    for (const col of MANUAL_ORDER_COLUMNS) {
      expect(
        MANUAL_PAYMENT_MIGRATION_SQL,
        `banner admin tidak menambahkan kolom ${col}`,
      ).toContain(`add column if not exists ${col}`);
      expect(sqlFile, `002_manual_payment.sql tidak menambahkan kolom ${col}`).toContain(
        `add column if not exists ${col}`,
      );
    }
  });

  it("membuat tabel konfigurasi QR + memuat ulang schema cache", () => {
    for (const sql of [MANUAL_PAYMENT_MIGRATION_SQL, sqlFile]) {
      expect(sql).toContain("create table if not exists public.manual_payment_settings");
      expect(sql).toContain("notify pgrst, 'reload schema'");
    }
  });

  it("menyebut nama file migrasi yang sama di banner dan di repo", () => {
    expect(MANUAL_PAYMENT_MIGRATION_FILE).toBe("supabase/store/002_manual_payment.sql");
    expect(sqlFile).toContain("AMAN DIJALANKAN BERULANG");
  });
});
