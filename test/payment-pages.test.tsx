/**
 * SMOKE TEST RENDER HALAMAN PEMBAYARAN & ADMIN.
 *
 * Unit test domain (manual-payment-flow) memastikan state machine-nya benar;
 * file ini memastikan HALAMAN-nya benar-benar bisa dirender untuk setiap bentuk
 * order yang ada di produksi — termasuk order ARSIP dari masa QRIS otomatis.
 *
 * Yang dicek:
 *  - buyer melihat tombol WhatsApp berisi kode order + nominal (tanpa QR/rekening),
 *  - form klaim hanya muncul untuk order manual yang memang bisa diklaim,
 *  - order PAID / EXPIRED / arsip dirender tanpa error dan tanpa tombol menyesatkan,
 *  - halaman pengaturan & detail order admin tidak pecah pada order arsip.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeDb, type Row } from "./helpers/fake-store";

// --- mocks ------------------------------------------------------------------
const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof createFakeDb>,
  env: {
    MANUAL_PAYMENT_ENABLED: true,
    WHATSAPP_SELLER_NUMBER: "",
  } as Record<string, unknown>,
  ctx: null as unknown,
  redirects: [] as string[],
  notFoundCalls: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  storeDb: async () => h.db,
  accountAdmin: async () => h.db,
  accountServer: async () => h.db,
}));

vi.mock("@/lib/env", () => ({
  serverEnv: () => h.env,
  telegramConfigured: () => false,
}));

vi.mock("@/lib/integrations/telegram", () => ({
  getNotifier: () => ({
    notifyOrderPaid: vi.fn(),
    notifyManualPaymentClaim: vi.fn(),
  }),
  buildPaidOrderInfo: () => ({}),
  buildManualClaimInfo: () => ({}),
}));

// Produk dibaca lewat cache Next (`unstable_cache`) — di luar runtime Next
// loader itu tidak jalan, jadi cukup beri produk tetap.
vi.mock("@/lib/products", () => ({
  getProduct: async () => ({
    id: "33333333-3333-4333-8333-333333333333",
    name: "Kopi Gayo 250g",
    description: "",
    price: 50000,
    image_url: null,
    is_active: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  }),
  getProductCached: async () => null,
  listActiveProducts: async () => [],
}));

vi.mock("@/lib/authz", () => ({
  getAuthContext: async () => h.ctx,
  isAdmin: (ctx: { profile?: { role?: string } } | null) => ctx?.profile?.role === "admin",
  requireUser: async () => h.ctx,
  requireVerifiedUser: async () => h.ctx,
  requireAdmin: async () => h.ctx,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => "/pay/ORD-20260912-MANU4L",
  useSearchParams: () => new URLSearchParams(),
  redirect: (url: string) => {
    h.redirects.push(url);
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {
    h.notFoundCalls.push("notFound");
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import PayPage from "@/app/pay/[code]/page";
import AdminPaymentSettingsPage from "@/app/admin/(panel)/settings/page";
import AdminOrderDetailPage from "@/app/admin/(panel)/orders/[codeOrId]/page";
import { resetStoreSchemaCache } from "@/lib/store-schema";

// --- fixtures ---------------------------------------------------------------
const BUYER_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_CODE = "ORD-20260912-MANU4L";
const SELLER_WA = "628111222333";

function buyerCtx() {
  return {
    user: { id: BUYER_ID, email: "budi@example.com" },
    profile: {
      id: BUYER_ID,
      name: "Budi",
      email: "budi@example.com",
      whatsapp: "6281234567890",
      role: "buyer",
    },
    emailVerified: true,
  };
}

function adminCtx() {
  return { ...buyerCtx(), profile: { ...buyerCtx().profile, role: "admin" } };
}

function product(): Row {
  return {
    id: PRODUCT_ID,
    name: "Kopi Gayo 250g",
    description: "",
    price: 50000,
    image_url: null,
    is_active: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  };
}

function order(overrides: Row = {}): Row {
  return {
    id: ORDER_ID,
    order_code: ORDER_CODE,
    account_id: BUYER_ID,
    product_id: PRODUCT_ID,
    product_name_snapshot: "Kopi Gayo 250g",
    unit_price_snapshot: 50000,
    quantity: 1,
    total_amount: 50000,
    charged_amount: 50417,
    payment_method: "MANUAL",
    payment_status: "PENDING",
    order_status: "PENDING",
    payment_id: null,
    payment_url: null,
    qr_image_url: null,
    payment_expired_at: new Date(Date.now() + 3_600_000).toISOString(),
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

function setup(rows: Row[], settings: Row | null = settingsRow()) {
  h.db = createFakeDb({
    products: [product()],
    orders: rows,
    ...(settings ? { manual_payment_settings: [settings] } : {}),
  });
}

async function renderPay(orderRow: Row): Promise<string> {
  setup([orderRow]);
  const el = await PayPage({ params: Promise.resolve({ code: ORDER_CODE }) });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  resetStoreSchemaCache();
  h.ctx = buyerCtx();
  h.redirects = [];
  h.notFoundCalls = [];
  h.env.MANUAL_PAYMENT_ENABLED = true;
  h.env.WHATSAPP_SELLER_NUMBER = "";
});

// ---------------------------------------------------------------------------
describe("/pay/[code] — order manual menunggu transfer", () => {
  it("menampilkan tombol WhatsApp berisi kode order + nominal, tanpa QR/rekening", async () => {
    const html = await renderPay(order());

    expect(html).toContain("Buka WhatsApp Penjual");
    expect(html).toContain("wa.me/628111222333");
    // Pesan chat sudah terisi kode order & nominal (URL-encoded).
    const decoded = decodeURIComponent(html);
    expect(decoded).toContain(ORDER_CODE);
    expect(decoded).toContain("Rp50.417");
    // Nominal final (= total + kode unik) yang ditagihkan.
    expect(html).toContain("Rp50.417");
    // Detail pembayaran tidak pernah dirender aplikasi.
    expect(html.toLowerCase()).not.toContain("rekening:");
    expect(html).not.toContain("data:image/png;base64");
  });

  it("menampilkan form klaim untuk order manual yang belum diklaim", async () => {
    const html = await renderPay(order());
    expect(html).toContain("Saya sudah transfer");
  });

  it("setelah diklaim: form diganti status menunggu verifikasi (+ tombol bukti transfer)", async () => {
    const html = await renderPay(order({ manual_claim_at: new Date().toISOString() }));

    expect(html).toContain("Konfirmasi kamu sudah kami terima");
    expect(html).not.toContain("name=\"orderCode\"");
    expect(html).toContain("Kirim bukti transfer di WhatsApp");
  });

  it("menampilkan alasan penolakan penjual dan membiarkan klaim ulang", async () => {
    const html = await renderPay(
      order({
        manual_review_status: "REJECTED",
        manual_review_note: "nominal tidak ditemukan di mutasi",
      }),
    );

    expect(html).toContain("nominal tidak ditemukan di mutasi");
    expect(html).toContain("Saya sudah transfer");
  });

  it("tanpa nomor WhatsApp penjual: pesan jelas, bukan tombol mati", async () => {
    setup([order()], settingsRow({ whatsapp_number: "" }));
    const el = await PayPage({ params: Promise.resolve({ code: ORDER_CODE }) });
    const html = renderToStaticMarkup(el);

    expect(html).not.toContain("wa.me/");
    expect(html).toContain("Penjual belum mengatur nomor WhatsApp");
  });
});

describe("/pay/[code] — order PAID & kadaluarsa", () => {
  it("order PAID: kabar baik + tautan lacak, tanpa tombol transfer", async () => {
    const html = await renderPay(
      order({ payment_status: "PAID", order_status: "PAID", paid_at: new Date().toISOString() }),
    );

    expect(html).toContain("Pembayaran berhasil");
    expect(html).not.toContain("Buka WhatsApp Penjual");
  });

  it("order EXPIRED (belum pernah diklaim): tidak menyuruh transfer", async () => {
    const html = await renderPay(order({ payment_status: "EXPIRED", order_status: "EXPIRED" }));

    expect(html).toContain("Pembayaran kadaluarsa");
    expect(html).not.toContain("Saya sudah transfer");
  });

  it("order EXPIRED yang sudah diklaim: mengingatkan buyer menghubungi penjual", async () => {
    const html = await renderPay(
      order({
        payment_status: "EXPIRED",
        order_status: "EXPIRED",
        manual_claim_at: new Date().toISOString(),
      }),
    );

    expect(html).toContain("Kamu sudah melaporkan transfer");
    expect(html).toContain("Hubungi Penjual");
  });
});

describe("/pay/[code] — order ARSIP QRIS otomatis (STENLY/YOBASEPAY)", () => {
  it("tidak menawarkan klaim manual: form konfirmasi transfer tidak dirender", async () => {
    const html = await renderPay(
      order({ payment_method: "STENLY", payment_id: "YO-ABC123", charged_amount: null }),
    );

    expect(html).not.toContain("Saya sudah transfer");
    expect(html).toContain("QRIS otomatis");
  });

  it("tetap bisa menghubungi penjual walau order arsip sudah kadaluarsa", async () => {
    const html = await renderPay(
      order({
        payment_method: "YOBASEPAY",
        payment_status: "EXPIRED",
        order_status: "EXPIRED",
        charged_amount: null,
      }),
    );

    expect(html).toContain("Hubungi Penjual");
    expect(html).toContain("wa.me/628111222333");
  });
});

// ---------------------------------------------------------------------------
describe("Halaman /admin/settings", () => {
  it("siap dipakai: status hijau + form menampilkan nomor tersimpan", async () => {
    h.ctx = adminCtx();
    setup([], settingsRow());
    const html = renderToStaticMarkup(
      await AdminPaymentSettingsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Transfer via WhatsApp");
    expect(html).toContain('name="whatsapp_number"');
    expect(html).toContain(`value="${SELLER_WA}"`);
    expect(html).toContain("Tampil di halaman checkout");
    expect(html).not.toContain("Belum ada metode pembayaran yang bisa dipakai buyer");
  });

  it("nomor belum diisi: menjelaskan alasannya + ingatkan checkout belum aktif", async () => {
    h.ctx = adminCtx();
    setup([], settingsRow({ whatsapp_number: "" }));
    const html = renderToStaticMarkup(
      await AdminPaymentSettingsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Belum ada metode pembayaran yang bisa dipakai buyer");
    expect(html).toContain("nomor WhatsApp penjual belum diisi");
  });

  it("saklar env mati: status menjelaskan MANUAL_PAYMENT_ENABLED", async () => {
    h.ctx = adminCtx();
    h.env.MANUAL_PAYMENT_ENABLED = false;
    setup([], settingsRow());
    const html = renderToStaticMarkup(
      await AdminPaymentSettingsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("MANUAL_PAYMENT_ENABLED=false");
  });

  it("mengingatkan ketika nomor masih berasal dari env (belum disimpan di DB)", async () => {
    h.ctx = adminCtx();
    h.env.WHATSAPP_SELLER_NUMBER = "081299991111";
    setup([], settingsRow({ whatsapp_number: "" }));
    const html = renderToStaticMarkup(
      await AdminPaymentSettingsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("WHATSAPP_SELLER_NUMBER");
    expect(html).toContain("+62 8129-9991-111");
  });
});

// ---------------------------------------------------------------------------
describe("Halaman /admin/orders/[code] — detail order", () => {
  async function renderDetail(row: Row): Promise<string> {
    h.ctx = adminCtx();
    setup([row]);
    return renderToStaticMarkup(
      await AdminOrderDetailPage({
        params: Promise.resolve({ codeOrId: ORDER_CODE }),
        searchParams: Promise.resolve({}),
      }),
    );
  }

  it("order manual yang diklaim: menampilkan nominal ditagihkan + form verifikasi", async () => {
    const html = await renderDetail(
      order({ manual_claim_at: new Date().toISOString(), manual_claim_note: "Budi (GoPay)" }),
    );

    expect(html).toContain("Rp50.417");
    expect(html).toContain("Budi (GoPay)");
    expect(html).toContain("Konfirmasi Pembayaran Lunas");
    expect(html).toContain("Tolak Klaim");
  });

  it("order manual yang belum diklaim: penjual TETAP bisa mengonfirmasi transfer", async () => {
    // Pembayaran dikoordinasikan lewat WhatsApp — buyer sering transfer tanpa
    // menekan tombol klaim. Tombol konfirmasi tidak boleh hilang karena itu.
    const html = await renderDetail(order());

    expect(html).toContain("Buyer belum menekan");
    expect(html).toContain("Konfirmasi Pembayaran Lunas");
    // Tanpa klaim tidak ada yang bisa ditolak.
    expect(html).not.toContain("Tolak Klaim");
  });

  it("order manual kadaluarsa (belum diklaim): tetap bisa dicatat sebagai lunas", async () => {
    const html = await renderDetail(
      order({ payment_status: "EXPIRED", order_status: "EXPIRED" }),
    );

    expect(html).toContain("Order ini sudah kadaluarsa");
    expect(html).toContain("Konfirmasi Pembayaran Lunas");
  });

  it("order arsip QRIS otomatis: dirender apa adanya, tanpa form verifikasi manual", async () => {
    const html = await renderDetail(
      order({ payment_method: "STENLY", payment_id: "YO-ABC123", payment_status: "PAID", order_status: "PAID" }),
    );

    expect(html).toContain("QRIS Otomatis (lama)");
    expect(html).toContain("Order arsip QRIS otomatis (tidak dipakai lagi)");
    expect(html).toContain("YO-ABC123");
    expect(html).not.toContain("Konfirmasi Pembayaran Lunas");
    expect(html).not.toContain("Tolak Klaim");
  });
});
