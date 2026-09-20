/**
 * ALUR PEMBAYARAN QRIS OTOMATIS (STENLY) — end-to-end terhadap DOMAIN LOGIC ASLI
 * (lib/orders.ts) + route webhook asli, dengan fake Supabase (PostgREST-ish).
 *
 * Kasus yang wajib lulus sebelum migrasi dinyatakan selesai:
 *   1. Payment creation : order dibuat → Stenly dipanggil → payment_id & QR tersimpan.
 *   2. Successful payment: webhook valid → PENDING menjadi PAID + Telegram.
 *   3. Invalid signature : 403, order TETAP PENDING.
 *   4. Wrong amount     : webhook ditolak, order TETAP PENDING.
 *   5. Duplicate webhook: webhook kedua no-op, Telegram TIDAK dobel.
 *   6. Expired          : status expired → order EXPIRED.
 *   7. Harga selalu dari database (nominal dari browser diabaikan).
 */
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb, type Row } from "./helpers/fake-store";
import type { AuthContext } from "@/lib/authz";
import type { OrderRow } from "@/lib/types";

const WEBHOOK_SECRET = "whsec_rahasia_webhook";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
  env: {
    STENLY_API_KEY: "sk_test_rahasia",
    STENLY_WEBHOOK_SECRET: "whsec_rahasia_webhook",
    STENLY_BASE_URL: "https://stenly.id",
    STENLY_EXPIRY_MINUTES: 15,
    MANUAL_PAYMENT_ENABLED: true,
    DEFAULT_PAYMENT_METHOD: "STENLY",
    MANUAL_PAYMENT_QR_IMAGE_URL: null,
    NEXT_PUBLIC_SITE_URL: "https://toko.example",
  } as Record<string, unknown>,
  telegram: true,
  stenly: true,
  notifier: {
    notifyOrderPaid: vi.fn(
      async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }),
    ),
    notifyManualPaymentClaim: vi.fn(
      async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }),
    ),
  },
  provider: {
    createPayment: vi.fn(),
    checkStatus: vi.fn(),
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
  stenlyIsSandbox: () => true,
}));

vi.mock("@/lib/integrations/telegram", () => ({
  getNotifier: () => h.notifier,
  buildPaidOrderInfo: (o: { order_code: string }) => ({ orderCode: o.order_code }),
  buildManualClaimInfo: (o: { order_code: string }) => ({ orderCode: o.order_code }),
}));

// Provider di-stub pada level registry: adapter HTTP-nya diuji terpisah di
// test/stenly-adapter.test.ts. Di sini yang diuji adalah DOMAIN LOGIC-nya.
vi.mock("@/lib/integrations/payment", () => ({
  getPaymentProvider: () => ({
    name: "stenly",
    isConfigured: h.stenly,
    createPayment: h.provider.createPayment,
    checkStatus: h.provider.checkStatus,
    // Verifikasi signature memakai algoritma yang sama dengan adapter asli.
    verifyWebhookSignature: (rawBody: string, signature: string | null) => {
      if (!signature) return false;
      const expected = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(rawBody, "utf8")
        .digest("hex");
      const provided = signature.trim().toLowerCase();
      return provided.length === expected.length && provided === expected;
    },
    normalizeWebhook: (body: Record<string, unknown>) => {
      const data = (body.data ?? body) as Record<string, unknown>;
      const orderId = typeof data.order_id === "string" ? data.order_id : null;
      const statusMap: Record<string, string> = {
        paid: "paid",
        paid_after_expiry: "paid",
        sandbox_trx_paid: "paid",
        pending: "pending",
        expired: "expired",
        cancelled: "failed",
      };
      return {
        paymentId: orderId,
        orderCode: orderId,
        state: statusMap[String(data.status)] ?? "unknown",
        amount: typeof data.gross_amount === "number" ? data.gross_amount : null,
        raw: body,
      };
    },
  }),
}));

import { createOrderForBuyer, refreshOrderStatus } from "@/lib/orders";
import { POST as stenlyWebhook } from "@/app/api/webhooks/stenly/route";

// --- fixtures ---------------------------------------------------------------
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const BUYER_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_CODE = "ORD-20260920-STNLY1";
const TOTAL = 50000;

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

function orderRow(overrides: Row = {}): Row {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    order_code: ORDER_CODE,
    account_id: BUYER_ID,
    product_id: PRODUCT_ID,
    product_name_snapshot: "Kopi Gayo 250g",
    unit_price_snapshot: TOTAL,
    quantity: 1,
    total_amount: TOTAL,
    charged_amount: TOTAL,
    payment_method: "STENLY",
    payment_status: "PENDING",
    order_status: "PENDING",
    payment_id: ORDER_CODE,
    payment_url: `https://stenly.id/pay/${ORDER_CODE}`,
    qr_image_url: "data:image/png;base64,iVBORw0KGgo=",
    payment_expired_at: new Date(Date.now() + 15 * 60_000).toISOString(),
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
    created_at: "2026-09-20T02:00:00.000Z",
    updated_at: "2026-09-20T02:00:00.000Z",
    ...overrides,
  };
}

function setup(orders: Row[] = []) {
  h.db = createFakeDb({
    products: [
      {
        id: PRODUCT_ID,
        name: "Kopi Gayo 250g",
        description: "",
        price: TOTAL,
        image_url: null,
        is_active: true,
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T00:00:00.000Z",
      },
    ],
    orders,
    manual_payment_settings: [
      {
        id: 1,
        is_enabled: true,
        label: "Transfer Manual (QRIS)",
        account_name: "Toko Saya",
        instructions: "",
        expiry_minutes: 120,
        qr_image_mime: "image/png",
        qr_image_base64: "iVBORw0KGgoAAAANSUhEUg==",
        qr_image_size: 42,
        updated_at: "2026-09-12T02:00:00.000Z",
      },
    ],
  });
  return h.db;
}

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

/** Bangun request webhook Stenly lengkap dengan signature HMAC yang sah. */
function webhookRequest(
  payload: unknown,
  opts: { signature?: string | null } = {},
): Request {
  const raw = JSON.stringify(payload);
  const signature =
    opts.signature === undefined
      ? crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw, "utf8").digest("hex")
      : opts.signature;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== null) headers["x-stenly-signature"] = signature;
  return new Request("https://toko.example/api/webhooks/stenly", {
    method: "POST",
    headers,
    body: raw,
  });
}

function paidPayload(overrides: Record<string, unknown> = {}) {
  return {
    event: "payment.status_updated",
    data: {
      order_id: ORDER_CODE,
      project_slug: "toko-saya",
      gross_amount: TOTAL,
      currency: "IDR",
      payment_method: "qris",
      status: "paid",
      paid_at: "2026-09-20T07:10:00.000Z",
      journal_id: "payment-reference-123",
      ...overrides,
    },
    timestamp: 1788868200000,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callWebhook = (req: Request) => stenlyWebhook(req as any);

beforeEach(() => {
  h.telegram = true;
  h.stenly = true;
  h.env.DEFAULT_PAYMENT_METHOD = "STENLY";
  h.notifier.notifyOrderPaid.mockClear();
  h.notifier.notifyManualPaymentClaim.mockClear();
  h.provider.createPayment = vi.fn(async () => ({
    paymentId: ORDER_CODE,
    paymentUrl: `https://stenly.id/pay/${ORDER_CODE}`,
    qrImageUrl: "data:image/png;base64,iVBORw0KGgo=",
    qrPayload: "0002010102122667...",
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    chargedAmount: TOTAL,
  }));
  h.provider.checkStatus = vi.fn(async () => ({ state: "pending", amount: null, raw: {} }));
  setup();
});

// ---------------------------------------------------------------------------
describe("1. Payment creation", () => {
  it("order dibuat → Stenly dipanggil → payment_id, QR & expiry tersimpan", async () => {
    const res = await createOrderForBuyer(buyerCtx, {
      productId: PRODUCT_ID,
      quantity: 1,
      paymentMethod: "STENLY",
    });

    expect(h.provider.createPayment).toHaveBeenCalledTimes(1);
    const arg = h.provider.createPayment.mock.calls[0]![0] as { amount: number; orderCode: string };
    // Nominal dikirim dari harga DATABASE, dan order_code jadi referensi.
    expect(arg.amount).toBe(TOTAL);
    expect(arg.orderCode).toBe(res.order.order_code);

    const saved = onlyOrder(h.db);
    expect(saved.payment_method).toBe("STENLY");
    expect(saved.payment_id).toBe(ORDER_CODE);
    expect(saved.qr_image_url).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(saved.payment_url).toBe(`https://stenly.id/pay/${ORDER_CODE}`);
    expect(saved.payment_expired_at).toBeTruthy();
    expect(saved.charged_amount).toBe(TOTAL);
    expect(saved.payment_status).toBe("PENDING");
  });

  /** Harga TIDAK PERNAH dipercaya dari browser. */
  it("nominal selalu dari database walau klien mengirim harga lain", async () => {
    await createOrderForBuyer(buyerCtx, {
      productId: PRODUCT_ID,
      quantity: 2,
      paymentMethod: "STENLY",
      // Field harga palsu dari klien (tidak ada di skema input) harus diabaikan.
      ...({ total_amount: 1, price: 1 } as Record<string, unknown>),
    } as never);

    const sent = h.provider.createPayment.mock.calls[0]![0] as { amount: number };
    expect(sent.amount).toBe(TOTAL * 2);
    expect(onlyOrder(h.db).total_amount).toBe(TOTAL * 2);
  });

  it("gagal membuat payment → order ditandai gagal, buyer dapat pesan generic", async () => {
    h.provider.createPayment = vi.fn(async () => {
      throw new Error("provider down");
    });

    await expect(
      createOrderForBuyer(buyerCtx, {
        productId: PRODUCT_ID,
        quantity: 1,
        paymentMethod: "STENLY",
      }),
    ).rejects.toMatchObject({ status: 503 });

    const saved = onlyOrder(h.db);
    expect(saved.payment_status).toBe("FAILED");
    expect(saved.order_status).toBe("EXPIRED");
  });
});

// ---------------------------------------------------------------------------
describe("2. Successful payment (webhook)", () => {
  it("webhook valid → PENDING menjadi PAID + notifikasi Telegram sekali", async () => {
    setup([orderRow()]);

    const res = await callWebhook(webhookRequest(paidPayload()));
    await tick();

    expect(res.status).toBe(200);
    // Standar respon merchant Stenly: { "received": true }.
    expect(await res.json()).toMatchObject({ received: true, handled: "paid" });

    const order = onlyOrder(h.db);
    expect(order.payment_status).toBe("PAID");
    expect(order.order_status).toBe("PAID");
    expect(order.paid_at).toBeTruthy();
    expect(h.notifier.notifyOrderPaid).toHaveBeenCalledTimes(1);
  });

  it("paid_after_expiry (rekonsiliasi Stenly) juga membuat order PAID", async () => {
    setup([orderRow({ payment_status: "EXPIRED", order_status: "EXPIRED" })]);

    const res = await callWebhook(webhookRequest(paidPayload({ status: "paid_after_expiry" })));
    await tick();

    expect(res.status).toBe(200);
    expect(onlyOrder(h.db).payment_status).toBe("PAID");
  });

  it("kegagalan Telegram TIDAK membatalkan status PAID", async () => {
    setup([orderRow()]);
    h.notifier.notifyOrderPaid.mockResolvedValueOnce({ ok: false, error: "bot diblokir" });

    const res = await callWebhook(webhookRequest(paidPayload()));
    await tick();

    expect(res.status).toBe(200);
    expect(onlyOrder(h.db).payment_status).toBe("PAID");
  });
});

// ---------------------------------------------------------------------------
describe("3. Invalid signature", () => {
  it("signature salah → 403 dan order TETAP PENDING", async () => {
    setup([orderRow()]);

    const res = await callWebhook(
      webhookRequest(paidPayload(), { signature: "a".repeat(64) }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_SIGNATURE" } });
    expect(onlyOrder(h.db).payment_status).toBe("PENDING");
    expect(h.notifier.notifyOrderPaid).not.toHaveBeenCalled();
  });

  it("tanpa header signature → 403, order tidak disentuh", async () => {
    setup([orderRow()]);

    const res = await callWebhook(webhookRequest(paidPayload(), { signature: null }));

    expect(res.status).toBe(403);
    expect(onlyOrder(h.db).payment_status).toBe("PENDING");
  });

  /** Body yang diubah setelah ditandatangani harus gugur. */
  it("body dimodifikasi setelah signature dibuat → 403", async () => {
    setup([orderRow()]);
    const honest = JSON.stringify(paidPayload());
    const signature = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(honest, "utf8")
      .digest("hex");
    const tampered = JSON.stringify(paidPayload({ gross_amount: 1 }));

    const res = await callWebhook(
      new Request("https://toko.example/api/webhooks/stenly", {
        method: "POST",
        headers: { "x-stenly-signature": signature, "Content-Type": "application/json" },
        body: tampered,
      }),
    );

    expect(res.status).toBe(403);
    expect(onlyOrder(h.db).payment_status).toBe("PENDING");
  });
});

// ---------------------------------------------------------------------------
describe("4. Wrong amount", () => {
  it("nominal lebih kecil → webhook diabaikan, order TETAP PENDING", async () => {
    setup([orderRow()]);

    const res = await callWebhook(webhookRequest(paidPayload({ gross_amount: 10000 })));
    await tick();

    expect(res.status).toBe(200); // 200 agar Stenly berhenti retry
    expect(await res.json()).toMatchObject({ handled: "ignored", reason: "amount_mismatch" });
    expect(onlyOrder(h.db).payment_status).toBe("PENDING");
    expect(h.notifier.notifyOrderPaid).not.toHaveBeenCalled();
  });

  /**
   * Stenly menagih PERSIS gross_amount, jadi kelebihan bayar sekalipun bukan
   * pembayaran yang kita minta → jangan otomatis PAID.
   */
  it("nominal lebih besar dari total juga ditolak (toleransi 0 untuk QRIS otomatis)", async () => {
    setup([orderRow()]);

    const res = await callWebhook(webhookRequest(paidPayload({ gross_amount: TOTAL + 500 })));
    await tick();

    expect(await res.json()).toMatchObject({ handled: "ignored", reason: "amount_mismatch" });
    expect(onlyOrder(h.db).payment_status).toBe("PENDING");
  });

  it("tanpa nominal → ditolak (amount_missing)", async () => {
    setup([orderRow()]);
    const payload = paidPayload();
    delete (payload.data as Record<string, unknown>).gross_amount;

    const res = await callWebhook(webhookRequest(payload));
    await tick();

    expect(await res.json()).toMatchObject({ handled: "ignored", reason: "amount_missing" });
    expect(onlyOrder(h.db).payment_status).toBe("PENDING");
  });
});

// ---------------------------------------------------------------------------
describe("5. Duplicate webhook (idempotency)", () => {
  it("webhook kedua tidak memproses ulang & Telegram tidak dobel", async () => {
    setup([orderRow()]);

    const first = await callWebhook(webhookRequest(paidPayload()));
    await tick();
    const second = await callWebhook(webhookRequest(paidPayload()));
    await tick();
    const third = await callWebhook(webhookRequest(paidPayload()));
    await tick();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(await second.json()).toMatchObject({ reason: "already_processed" });

    const order = onlyOrder(h.db);
    expect(order.payment_status).toBe("PAID");
    // Notifikasi diklaim sekali lewat telegram_notified_at.
    expect(h.notifier.notifyOrderPaid).toHaveBeenCalledTimes(1);
    expect(table(h.db, "orders")).toHaveLength(1);
  });

  it("paid_at tidak ditimpa oleh webhook ulangan", async () => {
    setup([orderRow()]);
    await callWebhook(webhookRequest(paidPayload()));
    await tick();
    const firstPaidAt = onlyOrder(h.db).paid_at;

    await new Promise((r) => setTimeout(r, 5));
    await callWebhook(webhookRequest(paidPayload()));
    await tick();

    expect(onlyOrder(h.db).paid_at).toBe(firstPaidAt);
  });
});

// ---------------------------------------------------------------------------
describe("6. Expired", () => {
  it("webhook status expired → order EXPIRED", async () => {
    setup([orderRow()]);

    const res = await callWebhook(
      webhookRequest({
        event: "payment.status_updated",
        data: {
          order_id: ORDER_CODE,
          gross_amount: TOTAL,
          status: "expired",
          expires_at: "2026-09-20T07:20:00.000Z",
        },
        timestamp: 1788868200000,
      }),
    );
    await tick();

    expect(res.status).toBe(200);
    const order = onlyOrder(h.db);
    expect(order.payment_status).toBe("EXPIRED");
    expect(order.order_status).toBe("EXPIRED");
    expect(h.notifier.notifyOrderPaid).not.toHaveBeenCalled();
  });

  it("polling fallback: status expired dari API juga meng-expire order", async () => {
    setup([orderRow()]);
    h.provider.checkStatus = vi.fn(async () => ({ state: "expired", amount: null, raw: {} }));

    await refreshOrderStatus(onlyOrder(h.db));

    expect(onlyOrder(h.db).payment_status).toBe("EXPIRED");
  });

  it("webhook cancelled → order EXPIRED (tidak pernah PAID)", async () => {
    setup([orderRow()]);

    await callWebhook(
      webhookRequest({
        event: "payment.status_updated",
        data: { order_id: ORDER_CODE, gross_amount: TOTAL, status: "cancelled" },
      }),
    );
    await tick();

    expect(onlyOrder(h.db).payment_status).toBe("EXPIRED");
  });
});

// ---------------------------------------------------------------------------
describe("7. Polling fallback (bukan sumber kebenaran utama)", () => {
  it("status paid dari API dengan nominal benar → PAID", async () => {
    setup([orderRow()]);
    h.provider.checkStatus = vi.fn(async () => ({ state: "paid", amount: TOTAL, raw: {} }));

    await refreshOrderStatus(onlyOrder(h.db));
    await tick();

    expect(onlyOrder(h.db).payment_status).toBe("PAID");
    expect(h.notifier.notifyOrderPaid).toHaveBeenCalledTimes(1);
  });

  it("nominal polling tidak cocok → order tetap PENDING", async () => {
    setup([orderRow()]);
    h.provider.checkStatus = vi.fn(async () => ({ state: "paid", amount: 12345, raw: {} }));

    await refreshOrderStatus(onlyOrder(h.db));

    expect(onlyOrder(h.db).payment_status).toBe("PENDING");
  });

  it("throttle dipertahankan: cek kedua dalam 10 detik tidak memanggil provider", async () => {
    setup([orderRow()]);
    h.provider.checkStatus = vi.fn(async () => ({ state: "pending", amount: null, raw: {} }));

    await refreshOrderStatus(onlyOrder(h.db));
    expect(h.provider.checkStatus).toHaveBeenCalledTimes(1);

    // last_payment_checked_at baru saja di-set → panggilan kedua di-skip.
    const again = await refreshOrderStatus(onlyOrder(h.db));
    expect(again.checkedProvider).toBe(false);
    expect(h.provider.checkStatus).toHaveBeenCalledTimes(1);
  });

  it("order PAID tidak pernah ditanyakan lagi ke provider", async () => {
    setup([orderRow({ payment_status: "PAID", order_status: "PAID" })]);
    h.provider.checkStatus = vi.fn();

    const res = await refreshOrderStatus(onlyOrder(h.db));

    expect(res.checkedProvider).toBe(false);
    expect(h.provider.checkStatus).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("8. Webhook untuk order yang tidak dikenal", () => {
  it("order_id asing → diabaikan (tidak membuat order baru)", async () => {
    setup([orderRow()]);

    const res = await callWebhook(
      webhookRequest(paidPayload({ order_id: "ORD-TIDAK-ADA" })),
    );
    await tick();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: "ignored", reason: "order_not_found" });
    expect(table(h.db, "orders")).toHaveLength(1);
    expect(onlyOrder(h.db).payment_status).toBe("PENDING");
  });

  it("body bukan JSON tetapi signature cocok → 400", async () => {
    setup([orderRow()]);
    const raw = "bukan json";
    const signature = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(raw, "utf8")
      .digest("hex");

    const res = await callWebhook(
      new Request("https://toko.example/api/webhooks/stenly", {
        method: "POST",
        headers: { "x-stenly-signature": signature },
        body: raw,
      }),
    );

    expect(res.status).toBe(400);
    expect(onlyOrder(h.db).payment_status).toBe("PENDING");
  });
});
