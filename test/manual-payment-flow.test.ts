/**
 * Unit test ALUR PEMBAYARAN MANUAL VIA WHATSAPP — mengeksekusi domain logic
 * asli di lib/orders.ts + lib/payment-config.ts terhadap fake Supabase
 * (PostgREST-ish).
 *
 * Fokus (aturan emas yang tidak boleh rusak):
 *  - klaim buyer TIDAK bisa membuat order lunas; hanya konfirmasi penjual bisa;
 *  - nominal order = total + kode unik, dan order ditolak bila penjual belum
 *    mengatur nomor WhatsApp (jangan membuat order yatim);
 *  - idempotensi klaim/konfirmasi, penolakan nominal kurang, aturan expire;
 *  - order arsip (STENLY/YOBASEPAY) tidak bisa dikonfirmasi lewat jalur manual.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb, type Row } from "./helpers/fake-store";
import { manualUniqueCode } from "@/lib/payment-methods";
import type { AuthContext } from "@/lib/authz";
import type { OrderRow } from "@/lib/types";

// --- mocks (hoisted: dipakai factory vi.mock) -------------------------------
const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
  env: {
    MANUAL_PAYMENT_ENABLED: true,
    WHATSAPP_SELLER_NUMBER: "",
  } as Record<string, unknown>,
  telegram: true,
  notifier: {
    notifyOrderPaid: vi.fn(async () => ({ ok: true as const })),
    notifyManualPaymentClaim: vi.fn(async () => ({ ok: true as const })),
  },
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
  getNotifier: () => h.notifier,
  buildPaidOrderInfo: (o: { order_code: string }) => ({ orderCode: o.order_code }),
  buildManualClaimInfo: (o: { order_code: string; charged_amount: number | null }) => ({
    orderCode: o.order_code,
    expectedAmount: o.charged_amount,
  }),
}));

import { HttpError } from "@/lib/api";
import { resetStoreSchemaCache } from "@/lib/store-schema";
import {
  adminConfirmManualPayment,
  adminRejectManualClaim,
  claimManualPayment,
  createOrderForBuyer,
  refreshOrderStatus,
} from "@/lib/orders";

// --- fixtures ---------------------------------------------------------------
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const BUYER_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const SELLER_WA = "628111222333";

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

const adminCtx = {
  user: { id: ADMIN_ID, email: "penjual@example.com" },
  profile: { id: ADMIN_ID, name: "Penjual", email: "penjual@example.com", role: "admin" },
  emailVerified: true,
} as unknown as AuthContext;

function settingsRow(overrides: Row = {}): Row {
  return {
    id: 1,
    is_enabled: true,
    label: "Transfer via WhatsApp",
    account_name: "Toko Saya",
    instructions: "Detail pembayaran dikirim lewat chat.",
    expiry_minutes: 120,
    whatsapp_number: SELLER_WA,
    whatsapp_message_template: "",
    updated_at: "2026-09-12T02:00:00.000Z",
    ...overrides,
  };
}

function orderRow(overrides: Row = {}): Row {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    order_code: "ORD-20260912-MANU4L",
    account_id: BUYER_ID,
    product_id: PRODUCT_ID,
    product_name_snapshot: "Kopi Gayo 250g",
    unit_price_snapshot: 50000,
    quantity: 1,
    total_amount: 50000,
    charged_amount: 50000 + manualUniqueCode("ORD-20260912-MANU4L"),
    payment_method: "MANUAL",
    payment_status: "PENDING",
    order_status: "PENDING",
    payment_id: null,
    payment_url: null,
    qr_image_url: null,
    payment_expired_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    last_payment_checked_at: null,
    paid_at: null,
    telegram_notified_at: null,
    buyer_name_snapshot: "Budi",
    buyer_whatsapp_snapshot: "6281234567890",
    buyer_email_snapshot: "budi@example.com",
    manual_claim_at: null,
    manual_claim_note: "",
    manual_claim_reference: "",
    manual_claim_notified_at: null,
    manual_reviewed_at: null,
    manual_reviewed_by: null,
    manual_review_status: null,
    manual_review_note: "",
    created_at: "2026-09-12T02:00:00.000Z",
    updated_at: "2026-09-12T02:00:00.000Z",
    ...overrides,
  };
}

function setup(opts: { settings?: Row | null; orders?: Row[] } = {}) {
  h.db = createFakeDb({
    products: [
      {
        id: PRODUCT_ID,
        name: "Kopi Gayo 250g",
        description: "",
        price: 50000,
        image_url: null,
        is_active: true,
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T00:00:00.000Z",
      },
    ],
    orders: opts.orders ?? [],
    manual_payment_settings: opts.settings === null ? [] : [opts.settings ?? settingsRow()],
  });
  return h.db;
}

/** Ambil isi tabel fake (noUncheckedIndexedAccess: index Record bisa undefined). */
function table(db: FakeDb, name: string): Row[] {
  const rows = db.tables[name];
  if (!rows) throw new Error(`Fake: tabel "${name}" tidak ada`);
  return rows;
}

function onlyOrder(db: FakeDb): OrderRow {
  return table(db, "orders")[0] as unknown as OrderRow;
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  // Probe skema di-cache per instance → tiap kasus harus mulai dari nol.
  resetStoreSchemaCache();
  h.telegram = true;
  h.env.MANUAL_PAYMENT_ENABLED = true;
  h.env.WHATSAPP_SELLER_NUMBER = "";
  h.notifier.notifyOrderPaid.mockClear();
  h.notifier.notifyManualPaymentClaim.mockClear();
});

// ---------------------------------------------------------------------------
describe("createOrderForBuyer — transfer manual via WhatsApp", () => {
  it("membuat order MANUAL: nominal = total + kode unik, expiry dari pengaturan, nomor penjual ikut", async () => {
    const db = setup();
    const before = Date.now();

    const res = await createOrderForBuyer(buyerCtx, { productId: PRODUCT_ID, quantity: 1 });

    const order = onlyOrder(db);
    expect(res.paymentMethod).toBe("MANUAL");
    expect(order.payment_method).toBe("MANUAL");
    expect(order.total_amount).toBe(50000);
    expect(order.charged_amount).toBe(50000 + manualUniqueCode(order.order_code));
    // tidak ada transaksi provider apa pun
    expect(order.payment_id).toBeNull();
    expect(order.payment_url).toBeNull();
    expect(order.qr_image_url).toBeNull();
    expect(res.payment.sellerWhatsapp).toBe(SELLER_WA);
    // expiry = now + expiry_minutes (120)
    const expiry = Date.parse(order.payment_expired_at!);
    expect(expiry - before).toBeGreaterThan(119 * 60_000);
    expect(expiry - before).toBeLessThanOrEqual(121 * 60_000);
  });

  it("tetap MANUAL walau klien mengirim nilai metode lama (STENLY/YOBASEPAY)", async () => {
    const db = setup();
    // createOrderForBuyer memang tidak lagi menerima pilihan metode dari klien.
    const res = await createOrderForBuyer(buyerCtx, {
      productId: PRODUCT_ID,
      quantity: 2,
      ...( { paymentMethod: "STENLY" } as Record<string, unknown>),
    });

    expect(res.paymentMethod).toBe("MANUAL");
    expect(onlyOrder(db).payment_method).toBe("MANUAL");
    expect(onlyOrder(db).total_amount).toBe(100000);
  });

  it("menolak checkout (503) bila penjual belum mengatur nomor WhatsApp — tanpa order yatim", async () => {
    const db = setup({ settings: settingsRow({ whatsapp_number: "" }) });

    await expect(
      createOrderForBuyer(buyerCtx, { productId: PRODUCT_ID, quantity: 1 }),
    ).rejects.toMatchObject({ status: 503 });
    expect(table(db, "orders")).toHaveLength(0);
  });

  it("menolak checkout bila metode dimatikan penjual (503)", async () => {
    setup({ settings: settingsRow({ is_enabled: false }) });

    await expect(
      createOrderForBuyer(buyerCtx, { productId: PRODUCT_ID, quantity: 1 }),
    ).rejects.toMatchObject({ status: 503 });
    expect(table(h.db, "orders")).toHaveLength(0);
  });

  it("menolak checkout bila saklar env global dimatikan (503)", async () => {
    setup();
    h.env.MANUAL_PAYMENT_ENABLED = false;

    await expect(
      createOrderForBuyer(buyerCtx, { productId: PRODUCT_ID, quantity: 1 }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("nomor WhatsApp dari env dipakai sebagai cadangan bila kolom DB kosong", async () => {
    setup({ settings: settingsRow({ whatsapp_number: "" }) });
    h.env.WHATSAPP_SELLER_NUMBER = "0812-9999-1111";

    const res = await createOrderForBuyer(buyerCtx, { productId: PRODUCT_ID, quantity: 1 });
    expect(res.payment.sellerWhatsapp).toBe("6281299991111");
  });
});

// ---------------------------------------------------------------------------
describe("claimManualPayment (buyer menekan 'Saya sudah transfer')", () => {
  it("mencatat klaim tetapi TIDAK mengubah payment_status", async () => {
    const db = setup({ orders: [orderRow()] });

    const res = await claimManualPayment(onlyOrder(db), {
      note: "Budi Santoso (GoPay)",
      reference: "20260912193045123",
    });

    expect(res.changed).toBe(true);
    const order = onlyOrder(db);
    expect(order.manual_claim_at).toBeTruthy();
    expect(order.manual_claim_note).toBe("Budi Santoso (GoPay)");
    expect(order.manual_claim_reference).toBe("20260912193045123");
    // INTI KEAMANAN: klaim buyer bukan pembayaran
    expect(order.payment_status).toBe("PENDING");
    expect(order.order_status).toBe("PENDING");
    expect(order.paid_at).toBeNull();
  });

  it("mengirim notifikasi Telegram sekali (diklaim lewat manual_claim_notified_at)", async () => {
    const db = setup({ orders: [orderRow()] });

    await claimManualPayment(onlyOrder(db), { note: "Budi" });
    await tick();

    expect(h.notifier.notifyManualPaymentClaim).toHaveBeenCalledTimes(1);
    expect(onlyOrder(db).manual_claim_notified_at).toBeTruthy();
  });

  it("klaim kedua = no-op (tidak menimpa klaim pertama, tidak notify dua kali)", async () => {
    const db = setup({ orders: [orderRow()] });

    const first = await claimManualPayment(onlyOrder(db), { note: "Budi" });
    const firstAt = onlyOrder(db).manual_claim_at;
    const second = await claimManualPayment(onlyOrder(db), { note: "Orang lain" });
    await tick();

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(onlyOrder(db).manual_claim_at).toBe(firstAt);
    expect(onlyOrder(db).manual_claim_note).toBe("Budi");
    expect(h.notifier.notifyManualPaymentClaim).toHaveBeenCalledTimes(1);
  });

  it("menolak order arsip QRIS otomatis, order sudah lunas, dan order kadaluarsa (409)", async () => {
    setup({ orders: [orderRow({ payment_method: "STENLY" })] });
    await expect(claimManualPayment(onlyOrder(h.db), {})).rejects.toMatchObject({ status: 409 });

    setup({ orders: [orderRow({ payment_status: "PAID" })] });
    await expect(claimManualPayment(onlyOrder(h.db), {})).rejects.toMatchObject({ status: 409 });

    setup({ orders: [orderRow({ payment_status: "EXPIRED" })] });
    await expect(claimManualPayment(onlyOrder(h.db), {})).rejects.toMatchObject({ status: 409 });
    // status tidak berubah sama sekali
    expect(onlyOrder(h.db).payment_status).toBe("EXPIRED");
  });
});

// ---------------------------------------------------------------------------
describe("adminConfirmManualPayment (verifikasi penjual)", () => {
  it("membuat order PAID + review APPROVED + notifikasi 'LUNAS'", async () => {
    const db = setup({ orders: [orderRow({ manual_claim_at: new Date().toISOString() })] });

    const updated = await adminConfirmManualPayment(onlyOrder(db).id, adminCtx, {
      note: "mutasi GoPay 19:32",
    });

    expect(updated.payment_status).toBe("PAID");
    expect(updated.order_status).toBe("PAID");
    expect(onlyOrder(db).manual_review_status).toBe("APPROVED");
    expect(onlyOrder(db).manual_reviewed_by).toBe(ADMIN_ID);
    expect(onlyOrder(db).manual_review_note).toBe("mutasi GoPay 19:32");
    expect(onlyOrder(db).paid_at).toBeTruthy();
    await tick();
    expect(h.notifier.notifyOrderPaid).toHaveBeenCalledTimes(1);
  });

  it("idempoten: konfirmasi kedua ditolak 409, order tetap PAID", async () => {
    const db = setup({ orders: [orderRow({ manual_claim_at: new Date().toISOString() })] });
    await adminConfirmManualPayment(onlyOrder(db).id, adminCtx, {});

    await expect(
      adminConfirmManualPayment(onlyOrder(db).id, adminCtx, {}),
    ).rejects.toBeInstanceOf(HttpError);
    expect(onlyOrder(db).payment_status).toBe("PAID");
    await tick();
    expect(h.notifier.notifyOrderPaid).toHaveBeenCalledTimes(1);
  });

  it("menolak nominal masuk yang kurang dari total order (409) — order tetap PENDING", async () => {
    const db = setup({ orders: [orderRow({ manual_claim_at: new Date().toISOString() })] });

    await expect(
      adminConfirmManualPayment(onlyOrder(db).id, adminCtx, { receivedAmount: 49000 }),
    ).rejects.toMatchObject({ status: 409 });

    expect(onlyOrder(db).payment_status).toBe("PENDING");
    expect(onlyOrder(db).paid_at).toBeNull();
  });

  it("menerima nominal masuk yang sesuai & menyimpannya di charged_amount", async () => {
    const db = setup({ orders: [orderRow({ manual_claim_at: new Date().toISOString() })] });

    await adminConfirmManualPayment(onlyOrder(db).id, adminCtx, { receivedAmount: 50417 });

    expect(onlyOrder(db).charged_amount).toBe(50417);
    expect(onlyOrder(db).payment_status).toBe("PAID");
  });

  it("mengonfirmasi order manual TANPA klaim buyer (uang masuk duluan) tetap boleh", async () => {
    // Pembayaran dikoordinasikan lewat WhatsApp: buyer sering transfer tanpa
    // menekan "Saya sudah transfer". Penjual harus tetap bisa mencatat uangnya.
    const db = setup({ orders: [orderRow()] });
    expect(onlyOrder(db).manual_claim_at).toBeNull();

    const updated = await adminConfirmManualPayment(onlyOrder(db).id, adminCtx, {
      note: "mutasi masuk, buyer tidak klaim",
    });

    expect(updated.payment_status).toBe("PAID");
    expect(updated.order_status).toBe("PAID");
    expect(onlyOrder(db).manual_review_status).toBe("APPROVED");
    expect(onlyOrder(db).paid_at).toBeTruthy();
  });

  it("mengonfirmasi order manual yang sudah kadaluarsa (transfer telat) menghidupkan order", async () => {
    const db = setup({
      orders: [orderRow({ payment_status: "EXPIRED", order_status: "EXPIRED" })],
    });

    const updated = await adminConfirmManualPayment(onlyOrder(db).id, adminCtx, {});

    expect(updated.payment_status).toBe("PAID");
    expect(updated.order_status).toBe("PAID");
  });

  it("menolak order FAILED (409) tanpa menandai review APPROVED", async () => {
    const db = setup({
      orders: [orderRow({ payment_status: "FAILED", order_status: "EXPIRED" })],
    });

    await expect(
      adminConfirmManualPayment(onlyOrder(db).id, adminCtx, {}),
    ).rejects.toMatchObject({ status: 409 });

    // Tidak boleh ada review "disetujui" tanpa pembayaran yang ikut berubah.
    expect(onlyOrder(db).payment_status).toBe("FAILED");
    expect(onlyOrder(db).manual_review_status).toBeNull();
  });

  it("menolak order arsip QRIS otomatis (409) — jalur verifikasi manual hanya untuk MANUAL", async () => {
    const db = setup({
      orders: [orderRow({ payment_method: "STENLY", payment_id: "YO-ABC123" })],
    });

    await expect(
      adminConfirmManualPayment(onlyOrder(db).id, adminCtx, {}),
    ).rejects.toMatchObject({ status: 409 });
  });
});

// ---------------------------------------------------------------------------
describe("adminRejectManualClaim", () => {
  it("membersihkan klaim, mencatat alasan, order tetap PENDING", async () => {
    const db = setup({
      orders: [orderRow({ manual_claim_at: new Date().toISOString(), manual_claim_note: "Budi" })],
    });

    const updated = await adminRejectManualClaim(onlyOrder(db).id, adminCtx, {
      note: "nominal tidak ditemukan di mutasi",
    });

    expect(updated.manual_claim_at).toBeNull();
    expect(updated.manual_claim_note).toBe("");
    expect(updated.manual_review_status).toBe("REJECTED");
    expect(updated.manual_review_note).toBe("nominal tidak ditemukan di mutasi");
    expect(updated.payment_status).toBe("PENDING");
  });

  it("setelah ditolak, buyer boleh klaim ulang (jejak penolakan dibersihkan)", async () => {
    const db = setup({ orders: [orderRow()] });
    await claimManualPayment(onlyOrder(db), { note: "Budi" });
    await adminRejectManualClaim(onlyOrder(db).id, adminCtx, { note: "belum masuk" });

    const res = await claimManualPayment(onlyOrder(db), { note: "Budi Santoso" });
    expect(res.changed).toBe(true);
    expect(onlyOrder(db).manual_review_status).toBeNull();
    expect(onlyOrder(db).manual_review_note).toBe("");
    expect(onlyOrder(db).manual_claim_note).toBe("Budi Santoso");
  });

  it("menolak bila belum ada klaim (409)", async () => {
    const db = setup({ orders: [orderRow()] });
    await expect(adminRejectManualClaim(onlyOrder(db).id, adminCtx, {})).rejects.toMatchObject({
      status: 409,
    });
  });

  /**
   * REGRESI: guard race-safe sempat memakai `.is("payment_status","PENDING")`.
   * Di PostgREST `is.` hanya sah untuk null/true/false, jadi query itu ditolak
   * server (22P02) dan SETIAP penolakan klaim gagal dengan 409 palsu. Guard
   * harus memakai `.eq`.
   */
  it("tidak memakai filter `is.` untuk kolom teks (harus `eq`) saat mengunci status", async () => {
    const db = setup({
      orders: [orderRow({ manual_claim_at: new Date().toISOString(), manual_claim_note: "Budi" })],
    });

    await adminRejectManualClaim(onlyOrder(db).id, adminCtx, { note: "belum masuk" });

    // Fake store menandai filter `is.` non-boolean sebagai error 22P02.
    expect(db.calls.some((c) => c.includes("22P02"))).toBe(false);
    expect(onlyOrder(db).manual_review_status).toBe("REJECTED");
  });
});

// ---------------------------------------------------------------------------
describe("refreshOrderStatus — order manual (tanpa provider)", () => {
  it("TIDAK meng-expire order yang sudah diklaim walau lewat batas waktu", async () => {
    const db = setup({
      orders: [
        orderRow({
          manual_claim_at: new Date().toISOString(),
          payment_expired_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      ],
    });

    const res = await refreshOrderStatus(onlyOrder(db));

    expect(res.order.payment_status).toBe("PENDING");
  });

  it("meng-expire order yang belum diklaim setelah batas waktu + grasi", async () => {
    const db = setup({
      orders: [
        orderRow({ payment_expired_at: new Date(Date.now() - 120_000).toISOString() }),
      ],
    });

    const res = await refreshOrderStatus(onlyOrder(db));

    expect(res.order.payment_status).toBe("EXPIRED");
    expect(res.order.order_status).toBe("EXPIRED");
  });

  it("order yang masih dalam batas waktu tidak boleh berubah status", async () => {
    const db = setup({ orders: [orderRow()] });

    const res = await refreshOrderStatus(onlyOrder(db));

    expect(res.order.payment_status).toBe("PENDING");
    expect(res.order.order_status).toBe("PENDING");
  });

  it("tidak pernah menyentuh kolom provider (payment_id tetap null & tidak ada error)", async () => {
    const db = setup({ orders: [orderRow()] });

    await refreshOrderStatus(onlyOrder(db));

    expect(onlyOrder(db).payment_id).toBeNull();
    expect(onlyOrder(db).last_payment_checked_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("konfigurasi pembayaran manual via WhatsApp (lib/payment-config)", () => {
  it("available bila saklar aktif + nomor WA valid; nomor tampil terformat", async () => {
    setup();
    const { getManualPaymentView } = await import("@/lib/payment-config");

    const view = await getManualPaymentView();
    expect(view.available).toBe(true);
    expect(view.reason).toBeNull();
    expect(view.label).toBe("Transfer via WhatsApp");
    expect(view.sellerName).toBe("Toko Saya");
    expect(view.expiryMinutes).toBe(120);
    expect(view.whatsappNumber).toBe(SELLER_WA);
    expect(view.whatsappDisplay).toContain("+62");
    expect(view.numberFromDatabase).toBe(true);
  });

  it("reason=no_whatsapp bila nomor belum diisi → metode tidak ditawarkan ke buyer", async () => {
    setup({ settings: settingsRow({ whatsapp_number: "" }) });
    const { getManualPaymentView, getAvailablePaymentMethods } = await import(
      "@/lib/payment-config"
    );

    const view = await getManualPaymentView();
    expect(view.available).toBe(false);
    expect(view.reason).toBe("no_whatsapp");
    expect(await getAvailablePaymentMethods()).toEqual([]);
  });

  it("reason=disabled bila saklar penjual mati; reason=schema_missing bila DB belum dimigrasi", async () => {
    setup({ settings: settingsRow({ is_enabled: false }) });
    const { getManualPaymentView } = await import("@/lib/payment-config");
    expect((await getManualPaymentView()).reason).toBe("disabled");

    // Kolom whatsapp_number belum ada di database (migrasi 004 belum jalan).
    h.db = createFakeDb(
      {
        products: [],
        orders: [],
        manual_payment_settings: [settingsRow()],
      },
      { phantomColumns: { manual_payment_settings: ["whatsapp_number"] } },
    );
    // Cache probe dilepas: database berganti di tengah kasus.
    resetStoreSchemaCache();
    const { checkStoreSchema: check } = await import("@/lib/store-schema");
    expect((await check()).ready).toBe(false);
    expect((await getManualPaymentView()).reason).toBe("schema_missing");
  });

  it("saveManualPaymentSettings menormalisasi nomor (08… → 62…) dan menyimpan template", async () => {
    const db = setup();
    const { saveManualPaymentSettings } = await import("@/lib/payment-config");

    await saveManualPaymentSettings({
      label: "Transfer WhatsApp",
      account_name: "CV Toko Saya",
      expiry_minutes: 60,
      whatsapp_number: "0812-3456-7890",
      whatsapp_message_template: "Order {kode} total {total}",
    });

    const row = table(db, "manual_payment_settings")[0]!;
    expect(row.label).toBe("Transfer WhatsApp");
    expect(row.account_name).toBe("CV Toko Saya");
    expect(row.expiry_minutes).toBe(60);
    expect(row.whatsapp_number).toBe("6281234567890");
    expect(row.whatsapp_message_template).toBe("Order {kode} total {total}");
  });

  it("saveManualPaymentSettings menolak nomor tidak valid dengan 400", async () => {
    setup();
    const { saveManualPaymentSettings } = await import("@/lib/payment-config");

    await expect(
      saveManualPaymentSettings({ whatsapp_number: "12345" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("tetap jalan (metode dianggap belum siap) bila baris settings belum ada", async () => {
    h.db = createFakeDb({ products: [], orders: [] });
    // tanpa baris id=1 → getManualPaymentSettings mengembalikan null (bukan crash)
    const { getManualPaymentView } = await import("@/lib/payment-config");

    const view = await getManualPaymentView();
    expect(view.available).toBe(false);
    expect(view.reason).toBe("disabled");
  });

  it("getCheckoutPaymentMethods selalu satu opsi (MANUAL) dan non-aktif bila belum siap", async () => {
    setup();
    const { getCheckoutPaymentMethods } = await import("@/lib/payment-config");

    const methods = await getCheckoutPaymentMethods();
    expect(methods).toHaveLength(1);
    expect(methods[0]?.id).toBe("MANUAL");
    expect(methods[0]?.disabled).toBe(false);

    setup({ settings: settingsRow({ whatsapp_number: "" }) });
    const blocked = await getCheckoutPaymentMethods();
    expect(blocked[0]?.disabled).toBe(true);
  });

  it("resolvePaymentMethod selalu MANUAL dan menolak 503 bila belum siap", async () => {
    setup();
    const { resolvePaymentMethod } = await import("@/lib/payment-config");

    expect(await resolvePaymentMethod(undefined)).toBe("MANUAL");
    expect(await resolvePaymentMethod("manual")).toBe("MANUAL");
    // nilai ngawur dari klien bukan alasan menolak — tetap MANUAL
    expect(await resolvePaymentMethod("GOPAY")).toBe("MANUAL");

    setup({ settings: settingsRow({ is_enabled: false }) });
    await expect(resolvePaymentMethod(undefined)).rejects.toMatchObject({ status: 503 });
  });
});
