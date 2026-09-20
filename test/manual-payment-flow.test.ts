/**
 * Unit test ALUR PEMBAYARAN MANUAL — mengeksekusi domain logic asli di
 * lib/orders.ts + lib/payment-config.ts terhadap fake Supabase (PostgREST-ish).
 *
 * Fokus: klaim buyer TIDAK bisa membuat order lunas; hanya konfirmasi penjual
 * yang bisa. Plus: idempotensi, penolakan nominal kurang, dan aturan expire.
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
    STENLY_EXPIRY_MINUTES: 15,
    MANUAL_PAYMENT_ENABLED: true,
    DEFAULT_PAYMENT_METHOD: "MANUAL",
    MANUAL_PAYMENT_QR_IMAGE_URL: null,
  } as Record<string, unknown>,
  telegram: true,
  stenly: false,
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
  stenlyConfigured: () => h.stenly,
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
    label: "Transfer Manual (QRIS GoPay)",
    account_name: "Toko Saya",
    instructions: "Pakai GoPay/OVO/DANA.",
    expiry_minutes: 120,
    qr_image_mime: "image/png",
    qr_image_base64: "iVBORw0KGgoAAAANSUhEUg==",
    qr_image_size: 42,
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
  h.telegram = true;
  h.stenly = false;
  h.env.MANUAL_PAYMENT_ENABLED = true;
  h.env.DEFAULT_PAYMENT_METHOD = "MANUAL";
  h.notifier.notifyOrderPaid.mockClear();
  h.notifier.notifyManualPaymentClaim.mockClear();
});

// ---------------------------------------------------------------------------
describe("createOrderForBuyer — metode manual", () => {
  it("membuat order MANUAL dengan nominal = total + kode unik & batas waktu dari pengaturan", async () => {
    const db = setup();
    const before = Date.now();

    const res = await createOrderForBuyer(buyerCtx, {
      productId: PRODUCT_ID,
      quantity: 1,
      paymentMethod: "MANUAL",
    });

    const order = onlyOrder(db);
    expect(res.paymentMethod).toBe("MANUAL");
    expect(order.payment_method).toBe("MANUAL");
    expect(order.total_amount).toBe(50000);
    expect(order.charged_amount).toBe(50000 + manualUniqueCode(order.order_code));
    // tidak ada transaksi provider
    expect(order.payment_id).toBeNull();
    expect(res.payment.paymentId).toBeNull();
    expect(res.payment.qrImageUrl).toMatch(/^\/api\/manual-qr\?v=/);
    // expiry = now + expiry_minutes (120)
    const expiry = Date.parse(order.payment_expired_at!);
    expect(expiry - before).toBeGreaterThan(119 * 60_000);
    expect(expiry - before).toBeLessThanOrEqual(121 * 60_000);
  });

  it("memakai metode default dari env bila buyer tidak memilih", async () => {
    const db = setup();
    h.env.DEFAULT_PAYMENT_METHOD = "MANUAL";

    const res = await createOrderForBuyer(buyerCtx, { productId: PRODUCT_ID, quantity: 2 });

    expect(res.paymentMethod).toBe("MANUAL");
    expect(onlyOrder(db).total_amount).toBe(100000);
  });

  it("menolak QRIS otomatis bila provider tidak dikonfigurasi (409, tanpa order yatim)", async () => {
    const db = setup();
    h.stenly = false;

    await expect(
      createOrderForBuyer(buyerCtx, { productId: PRODUCT_ID, quantity: 1, paymentMethod: "STENLY" }),
    ).rejects.toMatchObject({ status: 409 });
    // ditolak SEBELUM insert → tidak ada order yatim yang menggantung
    expect(table(db, "orders")).toHaveLength(0);
  });

  it("menolak checkout bila tidak ada metode pembayaran yang tersedia (503)", async () => {
    setup({ settings: settingsRow({ is_enabled: false }) });

    await expect(
      createOrderForBuyer(buyerCtx, { productId: PRODUCT_ID, quantity: 1 }),
    ).rejects.toMatchObject({ status: 503 });
    expect(table(h.db, "orders")).toHaveLength(0);
  });

  it("menolak MANUAL yang di-request eksplisit saat metode manual dimatikan penjual (409)", async () => {
    const db = setup({ settings: settingsRow({ is_enabled: false }) });
    h.stenly = true; // provider aktif → hanya STENLY yang tersedia

    await expect(
      createOrderForBuyer(buyerCtx, { productId: PRODUCT_ID, quantity: 1, paymentMethod: "MANUAL" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(table(db, "orders")).toHaveLength(0);
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

  it("menolak order QRIS otomatis, order sudah lunas, dan order kadaluarsa (409)", async () => {
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

  it("menolak order yang bukan pembayaran manual (409)", async () => {
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
   * server (22P02) dan SETIAP penolakan klaim gagal dengan 409 palsu — tombol
   * "Tolak Klaim" mustahil dipakai penjual. Guard harus memakai `.eq`.
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
describe("refreshOrderStatus — order manual", () => {
  it("TIDAK meng-expire order manual yang sudah diklaim walau lewat batas waktu", async () => {
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
    expect(res.checkedProvider).toBe(false);
  });

  it("meng-expire order manual yang belum diklaim setelah batas waktu + grasi", async () => {
    const db = setup({
      orders: [
        orderRow({ payment_expired_at: new Date(Date.now() - 120_000).toISOString() }),
      ],
    });

    const res = await refreshOrderStatus(onlyOrder(db));

    expect(res.order.payment_status).toBe("EXPIRED");
    expect(res.order.order_status).toBe("EXPIRED");
  });

  it("order manual tidak pernah memanggil provider (payment_id null aman)", async () => {
    const db = setup({ orders: [orderRow()] });

    const res = await refreshOrderStatus(onlyOrder(db));

    expect(res.checkedProvider).toBe(false);
    expect(res.order.payment_status).toBe("PENDING");
  });
});

// ---------------------------------------------------------------------------
describe("konfigurasi pembayaran manual (lib/payment-config)", () => {
  it("available bila saklar aktif + QR terunggah; qrSrc menunjuk endpoint gambar", async () => {
    setup();
    const { getManualPaymentView } = await import("@/lib/payment-config");

    const view = await getManualPaymentView();
    expect(view.available).toBe(true);
    expect(view.reason).toBeNull();
    expect(view.label).toBe("Transfer Manual (QRIS GoPay)");
    expect(view.accountName).toBe("Toko Saya");
    expect(view.expiryMinutes).toBe(120);
    expect(view.qrSrc).toBe("/api/manual-qr?v=2026-09-12T02%3A00%3A00.000Z");
  });

  it("reason=no_qr bila belum ada gambar → metode tidak ditawarkan ke buyer", async () => {
    setup({ settings: settingsRow({ qr_image_base64: null, qr_image_size: 0 }) });
    const { getManualPaymentView, getAvailablePaymentMethods } = await import("@/lib/payment-config");

    const view = await getManualPaymentView();
    expect(view.available).toBe(false);
    expect(view.reason).toBe("no_qr");
    expect(await getAvailablePaymentMethods()).toEqual([]);
  });

  it("MANUAL_PAYMENT_QR_IMAGE_URL (https) mengalahkan gambar hasil upload", async () => {
    setup();
    h.env.MANUAL_PAYMENT_QR_IMAGE_URL = "https://cdn.toko/qris.png";
    const { getManualPaymentView } = await import("@/lib/payment-config");

    const view = await getManualPaymentView();
    expect(view.qrSrc).toBe("https://cdn.toko/qris.png");
    expect(view.available).toBe(true);
    h.env.MANUAL_PAYMENT_QR_IMAGE_URL = null;
  });

  it("getAvailablePaymentMethods mengikuti konfigurasi provider + penjual", async () => {
    setup();
    const { getAvailablePaymentMethods } = await import("@/lib/payment-config");

    h.stenly = false;
    expect((await getAvailablePaymentMethods()).map((m) => m.id)).toEqual(["MANUAL"]);

    h.stenly = true;
    expect((await getAvailablePaymentMethods()).map((m) => m.id)).toEqual(["STENLY", "MANUAL"]);
  });

  it("resolvePaymentMethod: default env dipakai, metode tak tersedia ditolak 409", async () => {
    setup();
    const { resolvePaymentMethod } = await import("@/lib/payment-config");
    h.env.DEFAULT_PAYMENT_METHOD = "MANUAL";
    h.stenly = false;

    expect(await resolvePaymentMethod(undefined)).toBe("MANUAL");
    expect(await resolvePaymentMethod("manual")).toBe("MANUAL");
    await expect(resolvePaymentMethod("STENLY")).rejects.toMatchObject({ status: 409 });
    // nilai ngawur dari klien → fallback default, bukan error
    expect(await resolvePaymentMethod("GOPAY")).toBe("MANUAL");
  });

  it("saveManualPaymentSettings menyimpan label/a.n./batas waktu + gambar QR", async () => {
    const db = setup();
    const { saveManualPaymentSettings } = await import("@/lib/payment-config");

    await saveManualPaymentSettings({
      label: "QRIS Toko Saya",
      account_name: "CV Toko Saya",
      expiry_minutes: 60,
      qr_image: { mime: "image/png", base64: "QUJD", size: 3 },
    });

    const row = table(db, "manual_payment_settings")[0]!;
    expect(row.label).toBe("QRIS Toko Saya");
    expect(row.account_name).toBe("CV Toko Saya");
    expect(row.expiry_minutes).toBe(60);
    expect(row.qr_image_base64).toBe("QUJD");
    expect(row.qr_image_size).toBe(3);
  });

  it("saveManualPaymentSettings bisa menghapus gambar QR (clear)", async () => {
    const db = setup();
    const { saveManualPaymentSettings, getManualPaymentView } = await import("@/lib/payment-config");

    await saveManualPaymentSettings({ qr_image: "clear" });

    expect(table(db, "manual_payment_settings")[0]!.qr_image_base64).toBeNull();
    expect((await getManualPaymentView()).available).toBe(false);
  });

  it("tetap jalan (metode manual dianggap belum siap) bila baris settings belum ada", async () => {
    h.db = createFakeDb({ products: [], orders: [] });
    // tanpa baris id=1 → getManualPaymentSettings mengembalikan null (bukan crash)
    const { getManualPaymentView } = await import("@/lib/payment-config");

    const view = await getManualPaymentView();
    expect(view.available).toBe(false);
    expect(view.reason).toBe("disabled");
  });

  it("getCheckoutPaymentMethods menaruh opsi manual pertama (aktif) dan QRIS berstatus ongoing (disabled) saat Stenly belum terkonfigurasi", async () => {
    setup();
    h.stenly = false;
    const { getCheckoutPaymentMethods } = await import("@/lib/payment-config");

    const checkoutMethods = await getCheckoutPaymentMethods();
    expect(checkoutMethods).toHaveLength(2);

    const [manualMethod, qrisMethod] = checkoutMethods;
    expect(manualMethod?.id).toBe("MANUAL");
    expect(manualMethod?.disabled).toBe(false);
    expect(manualMethod?.label).toContain("Transfer Manual");

    expect(qrisMethod?.id).toBe("STENLY");
    expect(qrisMethod?.disabled).toBe(true);
    expect(qrisMethod?.isOngoing).toBe(true);
    expect(qrisMethod?.statusBadge).toBe("Ongoing");
  });

  it("getCheckoutPaymentMethods membuka opsi QRIS otomatis (bisa dipilih) saat kredensial terisi", async () => {
    setup();
    h.stenly = true;
    const { getCheckoutPaymentMethods } = await import("@/lib/payment-config");

    const checkoutMethods = await getCheckoutPaymentMethods();
    expect(checkoutMethods).toHaveLength(2);

    const [manualMethod, qrisMethod] = checkoutMethods;
    // Manual tetap urutan pertama & jadi default, tetapi keduanya kini bisa dipilih.
    expect(manualMethod?.id).toBe("MANUAL");
    expect(manualMethod?.disabled).toBe(false);

    expect(qrisMethod?.id).toBe("STENLY");
    expect(qrisMethod?.disabled).toBeFalsy();
    expect(qrisMethod?.isOngoing).toBeFalsy();
    expect(qrisMethod?.statusBadge).toBeUndefined();
  });

  it("getCheckoutPaymentMethods tetap menampilkan QRIS ongoing walau manual sedang aktif & terkonfigurasi", async () => {
    setup();
    h.stenly = false;
    const { getCheckoutPaymentMethods, getAvailablePaymentMethods } = await import(
      "@/lib/payment-config"
    );

    // Ketersediaan server (order) tidak bergantung daftar tampilan checkout.
    await expect(getAvailablePaymentMethods()).resolves.toEqual([
      expect.objectContaining({ id: "MANUAL" }),
    ]);

    const qris = (await getCheckoutPaymentMethods()).find((m) => m.id === "STENLY");
    expect(qris?.disabled).toBe(true);
    expect(qris?.statusBadge).toBe("Ongoing");
  });

  it("getCheckoutPaymentMethods menonaktifkan manual jika pengaturan manual dimatikan penjual", async () => {
    setup({ settings: settingsRow({ is_enabled: false }) });
    const { getCheckoutPaymentMethods } = await import("@/lib/payment-config");

    const checkoutMethods = await getCheckoutPaymentMethods();
    const manualMethod = checkoutMethods.find((m) => m.id === "MANUAL");
    expect(manualMethod?.disabled).toBe(true);
  });
});
