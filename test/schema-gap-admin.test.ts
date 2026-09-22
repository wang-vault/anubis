/**
 * REGRESI BUG PRODUKSI — database store belum punya kolom pembayaran manual.
 *
 * Gejala yang dilaporkan:
 *   {"level":"error","event":"admin_order_list_failed",
 *    "message":"column orders.payment_method does not exist"}
 *   Error [HttpError]: Gagal memuat daftar order.  → status 500
 *   {"level":"error","event":"admin_stats_failed","message":""}
 * dan /admin berubah menjadi "Application error: a server-side exception has
 * occurred".
 *
 * Test ini mengeksekusi DOMAIN LOGIC ASLI di lib/orders.ts terhadap database
 * tiruan yang kolomnya belum di-migrasi: dashboard harus tetap tampil
 * (antrian manual kosong, statistik jalan), checkout tidak boleh 500, dan
 * semuanya pulih sendiri begitu migrasi dijalankan.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb, type Row } from "./helpers/fake-store";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
  env: {
    MANUAL_PAYMENT_ENABLED: true,
    WHATSAPP_SELLER_NUMBER: "",
  } as Record<string, unknown>,
  telegram: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  storeDb: async () => h.db,
  accountAdmin: async () => h.db,
  accountServer: async () => h.db,
}));

vi.mock("@/lib/env", () => ({
  serverEnv: () => h.env,
  telegramConfigured: () => h.telegram,
}));

vi.mock("@/lib/integrations/telegram", () => ({
  getNotifier: () => ({
    notifyOrderPaid: vi.fn(async () => ({ ok: true as const })),
    notifyManualPaymentClaim: vi.fn(async () => ({ ok: true as const })),
  }),
  buildPaidOrderInfo: (o: { order_code: string }) => ({ orderCode: o.order_code }),
  buildManualClaimInfo: (o: { order_code: string }) => ({ orderCode: o.order_code }),
}));

import { MANUAL_ORDER_COLUMNS, isMissingColumnError, resetStoreSchemaCache } from "@/lib/store-schema";
import {
  createOrderForBuyer,
  getAdminOrder,
  getAdminStats,
  listAdminOrders,
  listOrdersForBuyer,
} from "@/lib/orders";
import type { AuthContext } from "@/lib/authz";

// --- fixtures ---------------------------------------------------------------
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const BUYER_ID = "22222222-2222-4222-8222-222222222222";

const buyerCtx = {
  user: { id: BUYER_ID, email: "budi@example.com" },
  profile: {
    id: BUYER_ID,
    name: "Budi",
    email: "budi@example.com",
    whatsapp: "6281234567890",
    role: "buyer",
  },
  emailVerified: true,
} as unknown as AuthContext;

/** Kolom yang belum ada di database lama (charged_amount sudah ada lebih dulu). */
const MISSING = MANUAL_ORDER_COLUMNS.filter((c) => c !== "charged_amount");

function product(): Row {
  return {
    id: PRODUCT_ID,
    name: "VPS LOW 1",
    description: "",
    price: 40000,
    image_url: null,
    is_active: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  };
}

function order(overrides: Row = {}): Row {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    order_code: "ORD-20260916-AAAAAA",
    account_id: BUYER_ID,
    product_id: PRODUCT_ID,
    product_name_snapshot: "VPS LOW 1",
    unit_price_snapshot: 40000,
    quantity: 1,
    total_amount: 40000,
    charged_amount: null,
    payment_status: "PENDING",
    order_status: "PENDING",
    payment_id: null,
    payment_url: null,
    qr_image_url: null,
    payment_expired_at: null,
    last_payment_checked_at: null,
    paid_at: null,
    telegram_notified_at: null,
    buyer_name_snapshot: "Budi",
    buyer_whatsapp_snapshot: "6281234567890",
    buyer_email_snapshot: "budi@example.com",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function settings(): Row {
  return {
    id: 1,
    is_enabled: true,
    label: "Transfer via WhatsApp",
    account_name: "Toko Saya",
    instructions: "",
    expiry_minutes: 120,
    whatsapp_number: "628111222333",
    whatsapp_message_template: "",
    updated_at: "2026-09-12T02:00:00.000Z",
  };
}

/** Supabase #2 seperti di produksi saat error terjadi: kolom manual belum ada. */
function outdatedDb(orders: Row[] = [order()]): FakeDb {
  return createFakeDb(
    { products: [product()], orders, manual_payment_settings: [settings()] },
    { missingColumns: { orders: [...MISSING] } },
  );
}

/** Setelah penjual menjalankan 002_manual_payment.sql (baris id=1 ikut dibuat). */
function migratedDb(orders: Row[] = []): FakeDb {
  return createFakeDb({ products: [product()], orders, manual_payment_settings: [settings()] });
}

beforeEach(() => {
  resetStoreSchemaCache();
  h.env.MANUAL_PAYMENT_ENABLED = true;
  h.env.WHATSAPP_SELLER_NUMBER = "";
});

// ---------------------------------------------------------------------------
describe("database belum di-migrasi (kolom orders.payment_method tidak ada)", () => {
  it("fixture valid: query antrian manual memang ditolak (kolom tidak dikenal)", async () => {
    const db = outdatedDb();
    const { error } = await db
      .from("orders")
      .select("*")
      .eq("payment_method", "MANUAL")
      .not("manual_claim_at", "is", null);

    expect(error?.code).toBe("PGRST204");
    expect(isMissingColumnError(error)).toBe(true);
  });

  it("dashboard: antrian verifikasi manual kosong, BUKAN melempar 500", async () => {
    h.db = outdatedDb();

    // Sebelum perbaikan: HttpError 500 → "Application error" di /admin.
    await expect(listAdminOrders({ manualClaim: true })).resolves.toEqual([]);
  });

  it("dashboard: daftar order lain tetap termuat normal", async () => {
    h.db = outdatedDb([order(), order({ id: "2", order_code: "ORD-20260916-BBBBBB", order_status: "PAID", payment_status: "PAID" })]);

    const paid = await listAdminOrders({ status: "PAID" });
    const all = await listAdminOrders({});

    expect(paid).toHaveLength(1);
    expect(paid[0]?.order_code).toBe("ORD-20260916-BBBBBB");
    expect(all).toHaveLength(2);
  });

  it("statistik admin tetap terhitung (antrian manual dianggap 0)", async () => {
    h.db = outdatedDb([
      order({ order_status: "PAID", payment_status: "PAID", paid_at: new Date().toISOString() }),
      order({ id: "2", order_code: "ORD-20260916-BBBBBB" }),
    ]);

    const stats = await getAdminStats();

    expect(stats.needProcessing).toBe(1);
    expect(stats.pendingPayment).toBe(1);
    expect(stats.needVerification).toBe(0);
    expect(stats.ordersToday).toBe(2);
  });

  it("baris order dinormalkan: kolom manual yang hilang jadi default aman", async () => {
    h.db = outdatedDb();

    const row = await getAdminOrder("11111111-1111-4111-8111-111111111111");

    expect(row?.payment_method).toBe("MANUAL");
    expect(row?.manual_claim_at).toBeNull();
    expect(row?.manual_claim_note).toBe("");
    expect(row?.manual_review_note).toBe("");
  });

  it("checkout Transfer Manual ditolak 503 yang jelas — tanpa order menggantung", async () => {
    h.db = outdatedDb([]);

    await expect(
      createOrderForBuyer(buyerCtx, { productId: PRODUCT_ID, quantity: 1 }),
    ).rejects.toMatchObject({ status: 503 });

    expect(h.db.tables.orders).toHaveLength(0);
  });

  it("daftar order buyer tetap termuat walau skema belum siap", async () => {
    h.db = outdatedDb([order(), order({ id: "2", order_code: "ORD-20260916-BBBBBB" })]);

    const orders = await listOrdersForBuyer(BUYER_ID);

    expect(orders).toHaveLength(2);
    expect(orders[0]?.payment_method).toBe("MANUAL");
  });
});

// ---------------------------------------------------------------------------
describe("schema cache PostgREST basi (kolom dikenal cache, tidak ada di tabel)", () => {
  /** Persis kondisi di log produksi: SQLSTATE 42703 dari Postgres. */
  function phantomDb(orders: Row[] = [order()]): FakeDb {
    return createFakeDb(
      { products: [product()], orders, manual_payment_settings: [settings()] },
      { phantomColumns: { orders: [...MISSING] } },
    );
  }

  it("fixture valid: select=* ditolak Postgres 42703 (pesan di log produksi)", async () => {
    const db = phantomDb();
    const { error } = await db.from("orders").select("*");

    expect(error).toMatchObject({
      code: "42703",
      message: "column orders.payment_method does not exist",
    });
  });

  it("dashboard admin: daftar order diulang dengan kolom dasar, BUKAN 500", async () => {
    h.db = phantomDb([order({ order_status: "PAID", payment_status: "PAID" })]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const list = await listAdminOrders({ status: "PAID" });

    expect(list).toHaveLength(1);
    expect(list[0]?.order_code).toBe("ORD-20260916-AAAAAA");
    // kolom hantu tidak ikut terbawa → dinormalkan ke default aman
    expect(list[0]?.payment_method).toBe("MANUAL");
    expect(warn.mock.calls.join(" ")).toContain("admin_order_list_schema_gap");
    warn.mockRestore();
  });

  it("antrian verifikasi manual kosong (probe ikut mendeteksi kolom hantu)", async () => {
    h.db = phantomDb();

    await expect(listAdminOrders({ manualClaim: true })).resolves.toEqual([]);
  });

  it("daftar order buyer diulang dengan kolom dasar", async () => {
    h.db = phantomDb();

    const orders = await listOrdersForBuyer(BUYER_ID);

    expect(orders).toHaveLength(1);
    expect(orders[0]?.manual_claim_note).toBe("");
  });
});

// ---------------------------------------------------------------------------
describe("setelah penjual menjalankan 002_manual_payment.sql", () => {
  it("antrian verifikasi manual kembali terisi (tanpa redeploy)", async () => {
    // Kondisi awal: database lama → antrian kosong.
    h.db = outdatedDb([]);
    await expect(listAdminOrders({ manualClaim: true })).resolves.toEqual([]);

    // Penjual menjalankan migrasi: tabel fake diganti + cache skema dilepas
    // (di produksi cache kedaluwarsa sendiri tiap 60 detik).
    h.db = migratedDb([
      order({
        payment_method: "MANUAL",
        payment_status: "PENDING",
        manual_claim_at: new Date().toISOString(),
        manual_claim_note: "Budi (GoPay)",
      }),
    ]);
    resetStoreSchemaCache();

    const queue = await listAdminOrders({ manualClaim: true });

    expect(queue).toHaveLength(1);
    expect(queue[0]?.manual_claim_note).toBe("Budi (GoPay)");
  });

  it("checkout Transfer Manual kembali bisa membuat order MANUAL", async () => {
    h.db = migratedDb([]);

    const res = await createOrderForBuyer(buyerCtx, {
      productId: PRODUCT_ID,
      quantity: 1,
    });

    expect(res.paymentMethod).toBe("MANUAL");
    expect(h.db.tables.orders?.[0]?.payment_method).toBe("MANUAL");
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
/**
 * KOMPATIBILITAS ARSIP — order dari masa QRIS otomatis.
 *
 * Order lama (STENLY / YOBASEPAY) TIDAK BOLEH ditulis ulang maupun disembunyikan:
 * histori transaksi harus tetap terbaca di dashboard, dan order baru selalu
 * MANUAL — yang diterima oleh constraint versi mana pun.
 */
describe("order arsip QRIS otomatis tetap terbaca", () => {
  function db(orders: Row[], extra: Parameters<typeof createFakeDb>[1] = {}): FakeDb {
    return createFakeDb(
      { products: [product()], orders, manual_payment_settings: [settings()] },
      extra,
    );
  }

  it("order YoBasePay lama tetap utuh dibaca buyer maupun admin", async () => {
    h.db = db([
      order({
        payment_method: "YOBASEPAY",
        payment_status: "PAID",
        order_status: "PAID",
        payment_id: "YO-LEGACY-1",
      }),
    ]);

    const mine = await listOrdersForBuyer(BUYER_ID);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.payment_method).toBe("YOBASEPAY");
    expect(mine[0]?.payment_id).toBe("YO-LEGACY-1");

    const detail = await getAdminOrder("11111111-1111-4111-8111-111111111111");
    expect(detail?.payment_method).toBe("YOBASEPAY");
    expect(detail?.payment_status).toBe("PAID");
  });

  it("checkout baru tetap MANUAL walau constraint masih versi lama", async () => {
    h.db = db(
      [],
      // Constraint versi paling lama: hanya mengenal YOBASEPAY + MANUAL.
      { checkConstraints: { orders: { payment_method: ["YOBASEPAY", "MANUAL"] } } },
    );

    const res = await createOrderForBuyer(buyerCtx, { productId: PRODUCT_ID, quantity: 1 });

    expect(res.paymentMethod).toBe("MANUAL");
    expect(h.db.tables.orders?.[0]?.payment_method).toBe("MANUAL");
  });
});

// ---------------------------------------------------------------------------
/**
 * REGRESI: pada database yang SUDAH di-migrasi, `listAdminOrders({})` sempat
 * mengembalikan daftar kosong karena filter antrian verifikasi manual
 * (`payment_method = MANUAL and manual_claim_at is not null`) ikut dipasang di
 * SETIAP pemanggilan — bukan hanya saat `manualClaim: true`. Akibatnya halaman
 * /admin/orders terlihat "tidak ada order" padahal datanya ada.
 */
describe("daftar order admin pada database sehat", () => {
  function healthyDb(orders: Row[]): FakeDb {
    return createFakeDb({ products: [product()], orders, manual_payment_settings: [settings()] });
  }

  it("tanpa filter: semua order tampil (QRIS otomatis maupun manual)", async () => {
    h.db = healthyDb([
      order({ id: "1", order_code: "ORD-A", payment_method: "STENLY" }),
      order({ id: "2", order_code: "ORD-B", payment_method: "MANUAL" }),
      order({ id: "3", order_code: "ORD-C", payment_method: "YOBASEPAY" }),
    ]);

    const all = await listAdminOrders({});

    expect(all.map((o) => o.order_code).sort()).toEqual(["ORD-A", "ORD-B", "ORD-C"]);
  });

  it("filter status tetap bekerja dan tidak ikut menyaring metode bayar", async () => {
    h.db = healthyDb([
      order({ id: "1", order_code: "ORD-A", payment_method: "STENLY", order_status: "PAID" }),
      order({ id: "2", order_code: "ORD-B", payment_method: "MANUAL", order_status: "PENDING" }),
    ]);

    const paid = await listAdminOrders({ status: "PAID" });

    expect(paid).toHaveLength(1);
    expect(paid[0]?.order_code).toBe("ORD-A");
  });

  it("manualClaim: true hanya menampilkan klaim manual yang menunggu verifikasi", async () => {
    h.db = healthyDb([
      order({ id: "1", order_code: "ORD-A", payment_method: "STENLY" }),
      order({
        id: "2",
        order_code: "ORD-B",
        payment_method: "MANUAL",
        payment_status: "PENDING",
        manual_claim_at: new Date().toISOString(),
      }),
      // manual tapi belum klaim → bukan antrian
      order({ id: "3", order_code: "ORD-C", payment_method: "MANUAL", manual_claim_at: null }),
    ]);

    const queue = await listAdminOrders({ manualClaim: true });

    expect(queue).toHaveLength(1);
    expect(queue[0]?.order_code).toBe("ORD-B");
  });
});
