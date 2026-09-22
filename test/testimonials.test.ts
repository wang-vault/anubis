/**
 * Unit test TESTIMONI OTOMATIS (lib/testimonials.ts):
 *  - query hanya mengambil order DONE, maksimal 20, terbaru duluan;
 *  - nama pembeli dipendekkan (privasi);
 *  - kolom yang di-query TIDAK menyertakan data sensitif
 *    (whatsapp / email / order_code / nominal);
 *  - kegagalan database → daftar kosong, bukan throw (halaman publik tak boleh 500).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type Row } from "./helpers/fake-store";
import {
  fetchDoneOrderTestimonials,
  maskBuyerName,
  TESTIMONIAL_LIMIT,
  TESTIMONIAL_SELECT_COLUMNS,
  type TestimonialItem,
} from "@/lib/testimonials";
import type { OrderRow } from "@/lib/types";

function doneOrder(overrides: Partial<OrderRow> = {}): Row {
  return {
    id: `id-${Math.random().toString(36).slice(2, 8)}`,
    order_code: "ORD-20260922-XXXXXX",
    account_id: "acct-1",
    product_id: "prod-1",
    product_name_snapshot: "Kopi Gayo 200g",
    unit_price_snapshot: 50000,
    quantity: 1,
    total_amount: 50000,
    payment_status: "PAID",
    order_status: "DONE",
    payment_method: "MANUAL",
    buyer_name_snapshot: "Budi Santoso",
    buyer_whatsapp_snapshot: "081234567890",
    buyer_email_snapshot: "budi@example.com",
    manual_claim_note: "",
    manual_claim_reference: "",
    manual_review_note: "",
    created_at: "2026-09-01T02:00:00.000Z",
    updated_at: "2026-09-10T02:00:00.000Z",
    ...overrides,
  } as Row;
}

// Fake db bukan SupabaseClient asli — cast sesuai antarmuka minimal lib.
// `raw` dipakai untuk mengisi tabel; `db` hanya bentuk yang diterima lib.
const raw = createFakeDb();
const db = raw as unknown as Parameters<typeof fetchDoneOrderTestimonials>[0];

beforeEach(() => {
  raw.tables.orders = [];
});

describe("maskBuyerName — privasi nama pembeli", () => {
  it("nama depan + inisial nama belakang", () => {
    expect(maskBuyerName("Budi Santoso")).toBe("Budi S.");
    expect(maskBuyerName("Budi Santoso Andi")).toBe("Budi A.");
  });
  it("satu kata: awal + *** + akhir", () => {
    expect(maskBuyerName("Rizky")).toBe("R***y");
    expect(maskBuyerName("An")).toBe("A***");
  });
  it("kosong / null / spasi saja → generik", () => {
    expect(maskBuyerName("")).toBe("Pembeli");
    expect(maskBuyerName(null)).toBe("Pembeli");
    expect(maskBuyerName(undefined)).toBe("Pembeli");
    expect(maskBuyerName("   ")).toBe("Pembeli");
  });
  it("spasi ganda dirapikan", () => {
    expect(maskBuyerName("  Budi   Santoso  ")).toBe("Budi S.");
  });
});

describe("kolom query — minimal & non-sensitif", () => {
  it("TIDAK menyertakan whatsapp / email / order_code / nominal", () => {
    const cols = TESTIMONIAL_SELECT_COLUMNS.split(",").map((c) => c.trim());
    expect(cols).toEqual(
      expect.arrayContaining(["buyer_name_snapshot", "product_name_snapshot", "quantity", "updated_at"]),
    );
    for (const forbidden of [
      "buyer_whatsapp_snapshot",
      "buyer_email_snapshot",
      "order_code",
      "account_id",
      "total_amount",
      "charged_amount",
      "*",
    ]) {
      expect(cols).not.toContain(forbidden);
    }
  });
});

describe("fetchDoneOrderTestimonials — query terhadap fake Supabase", () => {
  it("hanya order DONE yang menjadi testimoni", async () => {
    raw.tables.orders = [
      doneOrder({ id: "a", buyer_name_snapshot: "Budi Santoso", order_status: "DONE" }),
      doneOrder({ id: "b", order_status: "PENDING" }),
      doneOrder({ id: "c", order_status: "PAID" }),
      doneOrder({ id: "d", order_status: "PROCESSING" }),
      doneOrder({ id: "e", order_status: "EXPIRED" }),
    ];
    const items = await fetchDoneOrderTestimonials(db);
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("Budi S.");
  });

  it("maksimal 20 pesanan selesai (terbaru duluan)", async () => {
    const rows: Row[] = [];
    for (let i = 1; i <= 25; i++) {
      rows.push(
        doneOrder({
          id: `o${i}`,
          product_name_snapshot: `Produk ${i}`,
          updated_at: `2026-09-${String(i).padStart(2, "0")}T02:00:00.000Z`,
        }),
      );
    }
    raw.tables.orders = rows;
    const items = await fetchDoneOrderTestimonials(db);
    expect(items).toHaveLength(TESTIMONIAL_LIMIT);
    expect(TESTIMONIAL_LIMIT).toBe(20);
    // updated_at terbesar = 25 Sep → produk 25 tampil pertama.
    expect(items[0]!.productName).toBe("Produk 25");
    expect(items[items.length - 1]!.productName).toBe("Produk 6");
  });

  it("hasil hanya berisi field publik — data sensitif baris TIDAK ikut", async () => {
    raw.tables.orders = [
      doneOrder({
        buyer_whatsapp_snapshot: "081234567890",
        buyer_email_snapshot: "rahasia@example.com",
        order_code: "ORD-RAHASIA",
        total_amount: 999999,
        account_id: "acct-privat",
      }),
    ];
    const items = await fetchDoneOrderTestimonials(db);
    expect(items).toHaveLength(1);
    const keys = Object.keys(items[0]! as TestimonialItem).sort();
    expect(keys).toEqual(["completedAt", "name", "productName", "quantity"]);
    expect(JSON.stringify(items)).not.toContain("081234567890");
    expect(JSON.stringify(items)).not.toContain("rahasia@example.com");
    expect(JSON.stringify(items)).not.toContain("ORD-RAHASIA");
    expect(JSON.stringify(items)).not.toContain("999999");
    expect(JSON.stringify(items)).not.toContain("acct-privat");
  });

  it("quantity dibaca sebagai angka", async () => {
    raw.tables.orders = [
      doneOrder({ id: "q2", quantity: 2, product_name_snapshot: "Teh Melati" }),
    ];
    const items = await fetchDoneOrderTestimonials(db);
    expect(items[0]).toMatchObject({ productName: "Teh Melati", quantity: 2 });
  });

  it("database error → daftar kosong, TIDAK throw (halaman publik)", async () => {
    // Kolom quantity "tidak dikenal schema cache" → PGRST204.
    const brokenRaw = createFakeDb({}, { missingColumns: { orders: ["quantity"] } });
    const broken = brokenRaw as unknown as Parameters<
      typeof fetchDoneOrderTestimonials
    >[0];
    brokenRaw.tables.orders = [doneOrder()];
    const items = await fetchDoneOrderTestimonials(broken);
    expect(items).toEqual([]);
  });

  it("tabel kosong → daftar kosong", async () => {
    const items = await fetchDoneOrderTestimonials(db);
    expect(items).toEqual([]);
  });
});
