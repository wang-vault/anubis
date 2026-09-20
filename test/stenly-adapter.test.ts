/**
 * ADAPTER STENLY — kontrak HTTP terhadap dokumentasi resmi https://stenly.id/docs.
 *
 * Yang diuji di sini adalah hal-hal yang kalau salah akan merusak uang atau
 * membocorkan kredensial:
 *  - request create charge memakai endpoint/header/body persis seperti docs,
 *  - nominal yang dikirim = nominal dari server (bukan dari browser),
 *  - respons dengan order_id / nominal yang TIDAK cocok ditolak,
 *  - QR dirender lokal (secret key provider tidak pernah keluar ke browser),
 *  - signature webhook HMAC-SHA256 diverifikasi atas RAW body,
 *  - status provider dipetakan sesuai dokumentasi.
 *
 * `fetch` di-stub, jadi tidak ada panggilan jaringan sungguhan.
 */
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV = {
  STENLY_API_KEY: "sk_test_rahasia_sekali",
  STENLY_WEBHOOK_SECRET: "whsec_rahasia_webhook",
  STENLY_BASE_URL: "https://stenly.id",
  STENLY_EXPIRY_MINUTES: 15,
  NEXT_PUBLIC_SITE_URL: "https://toko.example",
};

const h = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  configured: true,
}));

vi.mock("@/lib/env", () => ({
  serverEnv: () => h.env,
  stenlyConfigured: () => h.configured,
  stenlyIsSandbox: () => String(h.env.STENLY_API_KEY ?? "").startsWith("sk_test_"),
}));

import { createStenlyProvider } from "@/lib/integrations/payment/stenly";
import { PaymentProviderError } from "@/lib/integrations/payment/types";

/** Contoh payload QRIS EMVCo (bentuk seperti contoh di dokumentasi). */
const QR_STRING =
  "00020101021226670016ID.STENLY.WWW01189360091800000000000215INV-2026082901520458125303360540550000" +
  "5802ID5909Toko Saya6007Jakarta6304ABCD";

/** Response 201 create charge — disalin dari dokumentasi resmi §Create Charge. */
function chargeResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "success",
    message: "Charge generated successfully",
    data: {
      order_id: "ORD-20260920-ABC123",
      project_slug: "toko-saya",
      gross_amount: 50000,
      currency: "IDR",
      status: "pending",
      payment_method: "qris",
      qr_string: QR_STRING,
      // Docs menunjukkan URL ini MEMBAWA SECRET KEY.
      qr_image_url: "/api/v1/qr/ORD-20260920-ABC123?api_key=sk_live_bocor",
      payment_url: "https://stenly.id/pay/ORD-20260920-ABC123",
      expires_at: "2026-09-20T07:20:00.000Z",
      created_at: "2026-09-20T07:05:00.000Z",
      ...overrides,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.env = { ...ENV };
  h.configured = true;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const INPUT = {
  amount: 50000,
  orderCode: "ORD-20260920-ABC123",
  description: "Order ORD-20260920-ABC123 - Kopi",
  customerName: "Budi",
  customerEmail: "budi@example.com",
  customerPhone: "081234567890",
};

// ---------------------------------------------------------------------------
describe("createPayment — request sesuai dokumentasi Stenly", () => {
  it("POST /api/v1/charge dengan header x-api-key dan body terdokumentasi", async () => {
    fetchMock.mockResolvedValue(jsonResponse(chargeResponse(), 201));

    await createStenlyProvider().createPayment(INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://stenly.id/api/v1/charge");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe(ENV.STENLY_API_KEY);
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      order_id: "ORD-20260920-ABC123",
      gross_amount: 50000,
      expiry_minutes: 15,
      customer_name: "Budi",
      customer_email: "budi@example.com",
      customer_phone: "081234567890",
    });
  });

  it("mengembalikan payment_id, expiry, dan charged amount dari provider", async () => {
    fetchMock.mockResolvedValue(jsonResponse(chargeResponse(), 201));

    const created = await createStenlyProvider().createPayment(INPUT);

    // Identitas transaksi Stenly = order_id yang kita kirim.
    expect(created.paymentId).toBe("ORD-20260920-ABC123");
    expect(created.chargedAmount).toBe(50000);
    expect(created.expiresAt).toBe("2026-09-20T07:20:00.000Z");
    expect(created.paymentUrl).toBe("https://stenly.id/pay/ORD-20260920-ABC123");
    expect(created.qrPayload).toBe(QR_STRING);
  });

  /**
   * KEAMANAN: `qr_image_url` milik Stenly membawa secret key. QR harus
   * dirender LOKAL dari qr_string, sehingga tidak ada kredensial yang sampai
   * ke browser pembeli.
   */
  it("QR dirender lokal menjadi data URI — API key provider tidak pernah ikut", async () => {
    fetchMock.mockResolvedValue(jsonResponse(chargeResponse(), 201));

    const created = await createStenlyProvider().createPayment(INPUT);

    expect(created.qrImageUrl?.startsWith("data:image/png;base64,")).toBe(true);
    expect(created.qrImageUrl).not.toContain("api_key");
    expect(created.qrImageUrl).not.toContain("sk_live");
    expect(created.qrImageUrl).not.toContain("sk_test");
  });

  it("payment_url dibersihkan bila provider menyertakan api_key (project sandbox)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        chargeResponse({
          payment_url: "https://stenly.id/pay/ORD-20260920-ABC123?api_key=sk_test_rahasia_sekali",
        }),
        201,
      ),
    );

    const created = await createStenlyProvider().createPayment(INPUT);

    expect(created.paymentUrl).toBe("https://stenly.id/pay/ORD-20260920-ABC123");
    expect(created.paymentUrl).not.toContain("api_key");
  });

  it("tanpa qr_string → qrImageUrl null, buyer tetap punya payment_url", async () => {
    const res = chargeResponse();
    delete (res.data as Record<string, unknown>).qr_string;
    fetchMock.mockResolvedValue(jsonResponse(res, 201));

    const created = await createStenlyProvider().createPayment(INPUT);

    expect(created.qrImageUrl).toBeNull();
    expect(created.paymentUrl).toBe("https://stenly.id/pay/ORD-20260920-ABC123");
  });
});

// ---------------------------------------------------------------------------
describe("createPayment — penolakan yang melindungi uang", () => {
  it("menolak bila provider membalas order_id milik transaksi lain", async () => {
    fetchMock.mockResolvedValue(jsonResponse(chargeResponse({ order_id: "ORD-LAIN" }), 201));

    await expect(createStenlyProvider().createPayment(INPUT)).rejects.toMatchObject({
      message: "provider_order_id_mismatch",
    });
  });

  it("menolak bila nominal yang ditagih provider berbeda dari total order", async () => {
    fetchMock.mockResolvedValue(jsonResponse(chargeResponse({ gross_amount: 45000 }), 201));

    await expect(createStenlyProvider().createPayment(INPUT)).rejects.toMatchObject({
      message: "provider_amount_mismatch",
    });
  });

  it("menolak nominal di bawah/di atas batas Stenly tanpa memanggil API", async () => {
    const provider = createStenlyProvider();
    await expect(provider.createPayment({ ...INPUT, amount: 999 })).rejects.toMatchObject({
      message: "amount_below_minimum",
    });
    await expect(provider.createPayment({ ...INPUT, amount: 10_000_001 })).rejects.toMatchObject({
      message: "amount_above_maximum",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("error HTTP provider menjadi PaymentProviderError (pesan tidak bocor ke buyer)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: "error", message: "Invalid API key" }, 403),
    );

    const err = await createStenlyProvider()
      .createPayment(INPUT)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PaymentProviderError);
    expect((err as PaymentProviderError).message).toContain("403");
    expect((err as PaymentProviderError).detail).toBe("Invalid API key");
  });

  it("provider tidak bisa dihubungi → provider_unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(createStenlyProvider().createPayment(INPUT)).rejects.toMatchObject({
      message: "provider_unreachable",
    });
  });

  it("kredensial kosong → provider_disabled (QRIS otomatis nonaktif)", async () => {
    h.configured = false;
    await expect(createStenlyProvider().createPayment(INPUT)).rejects.toMatchObject({
      message: "provider_disabled",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("checkStatus — GET /api/v1/status/:order_id", () => {
  it("memanggil endpoint status dengan secret key & memetakan status paid", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: "success",
        data: { order_id: "ORD-1", gross_amount: 50000, status: "paid" },
      }),
    );

    const res = await createStenlyProvider().checkStatus("ORD-1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://stenly.id/api/v1/status/ORD-1");
    expect(init.method).toBe("GET");
    expect(init.headers["x-api-key"]).toBe(ENV.STENLY_API_KEY);
    expect(res).toMatchObject({ state: "paid", amount: 50000 });
  });

  it("memetakan pending / expired / cancelled sesuai dokumentasi", async () => {
    const provider = createStenlyProvider();
    for (const [providerStatus, expected] of [
      ["pending", "pending"],
      ["expired", "expired"],
      ["cancelled", "failed"],
      ["paid_after_expiry", "paid"],
      ["sandbox_trx_paid", "paid"],
    ] as const) {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ status: "success", data: { order_id: "ORD-1", status: providerStatus } }),
      );
      const res = await provider.checkStatus("ORD-1");
      expect(res.state, providerStatus).toBe(expected);
    }
  });

  it("order_id di-URL-encode (tidak bisa dipakai menembus path lain)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: "success", data: { order_id: "x", status: "pending" } }),
    );
    await createStenlyProvider().checkStatus("../../admin/secret");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://stenly.id/api/v1/status/..%2F..%2Fadmin%2Fsecret",
    );
  });
});

// ---------------------------------------------------------------------------
describe("verifyWebhookSignature — HMAC-SHA256 atas RAW body", () => {
  const provider = () => createStenlyProvider();
  const RAW = JSON.stringify({
    event: "payment.status_updated",
    data: { order_id: "ORD-1", gross_amount: 50000, status: "paid" },
    timestamp: 1788868200000,
  });
  const sign = (body: string, secret = ENV.STENLY_WEBHOOK_SECRET) =>
    crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");

  it("menerima signature yang benar", () => {
    expect(provider().verifyWebhookSignature(RAW, sign(RAW))).toBe(true);
  });

  it("menerima bentuk huruf besar & prefix sha256=", () => {
    expect(provider().verifyWebhookSignature(RAW, sign(RAW).toUpperCase())).toBe(true);
    expect(provider().verifyWebhookSignature(RAW, `sha256=${sign(RAW)}`)).toBe(true);
  });

  it("menolak signature salah, secret salah, dan body yang diubah", () => {
    const p = provider();
    expect(p.verifyWebhookSignature(RAW, sign(RAW, "whsec_salah"))).toBe(false);
    expect(p.verifyWebhookSignature(`${RAW} `, sign(RAW))).toBe(false);
    expect(p.verifyWebhookSignature(RAW, "deadbeef")).toBe(false);
    expect(p.verifyWebhookSignature(RAW, "bukan-hex-sama-sekali")).toBe(false);
  });

  it("menolak bila header signature tidak ada", () => {
    expect(provider().verifyWebhookSignature(RAW, null)).toBe(false);
    expect(provider().verifyWebhookSignature(RAW, "")).toBe(false);
  });

  it("menolak semua signature bila webhook secret belum dikonfigurasi", () => {
    h.env = { ...ENV, STENLY_WEBHOOK_SECRET: "" };
    expect(provider().verifyWebhookSignature(RAW, sign(RAW))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("normalizeWebhook — payload bersarang { event, data, timestamp }", () => {
  it("membaca order_id, gross_amount, dan status dari data", () => {
    const event = createStenlyProvider().normalizeWebhook({
      event: "payment.status_updated",
      data: {
        order_id: "ORD-20260920-ABC123",
        project_slug: "toko-saya",
        gross_amount: 50000,
        currency: "IDR",
        payment_method: "qris",
        status: "paid",
        paid_at: "2026-09-20T07:10:00.000Z",
        journal_id: "payment-reference-123",
      },
      timestamp: 1788868200000,
    });

    expect(event).toMatchObject({
      paymentId: "ORD-20260920-ABC123",
      orderCode: "ORD-20260920-ABC123",
      state: "paid",
      amount: 50000,
    });
  });

  it("status expired (tanpa paid_at) tetap dinormalisasi", () => {
    const event = createStenlyProvider().normalizeWebhook({
      event: "payment.status_updated",
      data: { order_id: "ORD-1", gross_amount: 50000, status: "expired" },
    });
    expect(event.state).toBe("expired");
  });

  it("status di luar dokumentasi → unknown (order tidak disentuh)", () => {
    const event = createStenlyProvider().normalizeWebhook({
      data: { order_id: "ORD-1", gross_amount: 50000, status: "refunded" },
    });
    expect(event.state).toBe("unknown");
  });
});
