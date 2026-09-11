import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ErrorCodes, HttpError } from "@/lib/api";
import { accountAdmin, accountServer, storeDb } from "@/lib/supabase/server";
import { getPaymentProvider } from "@/lib/integrations/payment";
import { getManualPaymentView, resolvePaymentMethod } from "@/lib/payment-config";
import {
  PAYMENT_METHOD_MANUAL,
  isManualMethod,
  manualChargedAmount,
  type PaymentMethod,
} from "@/lib/payment-methods";
import {
  PaymentProviderError,
  type PaymentProvider,
} from "@/lib/integrations/payment/types";
import {
  buildManualClaimInfo,
  buildPaidOrderInfo,
  getNotifier,
} from "@/lib/integrations/telegram";
import { generateOrderCode } from "@/lib/order-code";
import { amountWithinTolerance } from "@/lib/money";
import { log } from "@/lib/logger";
import { serverEnv } from "@/lib/env";
import type { AuthContext } from "@/lib/authz";
import type { AdminOrderView, OrderRow, OrderStatus, ProductRow } from "@/lib/types";

/**
 * ===========================================================================
 * DOMAIN LOGIC ORDER — satu-satunya tempat status order boleh berubah.
 * ===========================================================================
 * Prinsip:
 *  - Harga & total SELALU dihitung server-side dari DB store (client tidak dipercaya).
 *  - Pembayaran menjadi PAID hanya lewat webhook terverifikasi ATAU cek status
 *    server-side ke YoBasePay — tidak pernah dari klaim frontend.
 *  - Semua transisi status idempotent (guard `where` di query update).
 *  - Notifikasi Telegram diklaim sekali per order (telegram_notified_at).
 */

/** Jarak minimal antar-cek status ke provider (anti hammering). */
const PROVIDER_CHECK_THROTTLE_MS = 10_000;
/** Grasi otomatis-expire setelah batas waktu provider. */
const EXPIRY_GRACE_MS = 30_000;

export type PaidSource = "webhook" | "polling" | "manual";

// ---------------------------------------------------------------------------
// BUYER — create order + payment
// ---------------------------------------------------------------------------

export interface CreateOrderResult {
  order: OrderRow;
  paymentMethod: PaymentMethod;
  payment: {
    /** null untuk pembayaran manual (tidak ada transaksi di provider). */
    paymentId: string | null;
    paymentUrl: string | null;
    qrImageUrl: string | null;
    expiresAt: string | null;
  };
}

export async function createOrderForBuyer(
  ctx: AuthContext,
  input: {
    productId: string;
    quantity: number;
    whatsappOverride?: string;
    paymentMethod?: unknown;
  },
): Promise<CreateOrderResult> {
  const db = await storeDb();
  const profile = ctx.profile!;

  // 1. Ambil produk + harga ASLI dari database (bukan dari client).
  const { data: product, error: pErr } = await db
    .from("products")
    .select("id,name,description,price,image_url,is_active,created_at,updated_at")
    .eq("id", input.productId)
    .maybeSingle<ProductRow>();
  if (pErr) {
    log.error("product_fetch_failed", { message: pErr.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal memuat produk.");
  }
  if (!product || !product.is_active) {
    throw new HttpError(
      404,
      ErrorCodes.notFound,
      "Produk tidak ditemukan atau sudah tidak dijual.",
    );
  }

  // 2. Hitung total server-side.
  const total = product.price * input.quantity;

  // 2b. Metode bayar: yang menentukan boleh/tidaknya = konfigurasi SERVER
  //     (env + pengaturan penjual), bukan nilai dari klien.
  const method = await resolvePaymentMethod(input.paymentMethod);

  // 3. Insert order PENDING dengan kode publik unik (retry jika tabrakan).
  let order: OrderRow | null = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    const { data, error } = await db
      .from("orders")
      .insert({
        order_code: generateOrderCode(),
        account_id: ctx.user.id,
        product_id: product.id,
        product_name_snapshot: product.name,
        unit_price_snapshot: product.price,
        quantity: input.quantity,
        total_amount: total,
        payment_method: method,
        payment_status: "PENDING",
        order_status: "PENDING",
        buyer_name_snapshot: profile.name,
        buyer_whatsapp_snapshot: input.whatsappOverride ?? profile.whatsapp,
        buyer_email_snapshot: ctx.user.email ?? profile.email,
      })
      .select("*")
      .single<OrderRow>();
    if (!error) {
      order = data;
      break;
    }
    if (error.code !== "23505") {
      log.error("order_insert_failed", { message: error.message });
      throw new HttpError(500, ErrorCodes.internal, "Gagal membuat order.");
    }
  }
  if (!order) {
    throw new HttpError(500, ErrorCodes.internal, "Gagal membuat order, coba lagi.");
  }

  // 4a. Pembayaran MANUAL: tidak ada provider. Nominal = total + kode unik
  //     (deterministik dari order_code) supaya mutasi mudah dicocokkan penjual.
  //     Batas waktu bayar diambil dari pengaturan penjual (bukan dari provider).
  if (method === PAYMENT_METHOD_MANUAL) {
    const manual = await getManualPaymentView();
    if (!manual.available) {
      log.error("manual_payment_not_configured", { reason: manual.reason });
      await db
        .from("orders")
        .update({ payment_status: "FAILED", order_status: "EXPIRED" })
        .eq("id", order.id)
        .eq("payment_status", "PENDING");
      throw new HttpError(
        503,
        ErrorCodes.paymentUnavailable,
        "Pembayaran manual belum siap. Silakan hubungi penjual.",
      );
    }
    const manualPatch = {
      charged_amount: manualChargedAmount(total, order.order_code),
      payment_expired_at: new Date(Date.now() + manual.expiryMinutes * 60_000).toISOString(),
    };
    const { data: manualOrder, error: mErr } = await db
      .from("orders")
      .update(manualPatch)
      .eq("id", order.id)
      .select("*")
      .single<OrderRow>();
    if (mErr || !manualOrder) {
      log.error("order_manual_setup_failed", {
        orderCode: order.order_code,
        message: mErr?.message,
      });
      throw new HttpError(
        500,
        ErrorCodes.internal,
        "Gagal menyiapkan pembayaran manual. Silakan coba lagi.",
      );
    }
    log.info("order_created", {
      orderCode: manualOrder.order_code,
      method,
      total,
      charged: manualOrder.charged_amount,
    });
    return {
      order: manualOrder,
      paymentMethod: method,
      payment: {
        paymentId: null,
        paymentUrl: null,
        qrImageUrl: manual.qrSrc,
        expiresAt: manualOrder.payment_expired_at,
      },
    };
  }

  // 4b. Buat pembayaran di YoBasePay (server-side; API key tak pernah ke browser).
  const provider = getPaymentProvider();
  let created;
  try {
    created = await provider.createPayment({
      amount: total,
      orderCode: order.order_code,
      description: `Order ${order.order_code} - ${product.name}`,
    });
  } catch (err) {
    const detail = err instanceof PaymentProviderError ? String(err.detail ?? err.message) : "";
    log.error("payment_create_failed", { orderCode: order.order_code, detail });
    // Tandai order agar tidak menggantung selamanya, buyer boleh mencoba lagi.
    await db
      .from("orders")
      .update({ payment_status: "FAILED", order_status: "EXPIRED" })
      .eq("id", order.id)
      .eq("payment_status", "PENDING");
    throw new HttpError(
      503,
      ErrorCodes.paymentUnavailable,
      "Gerbang pembayaran sedang tidak tersedia. Silakan coba lagi sebentar.",
    );
  }

  // 5. Simpan referensi pembayaran pada order (termasuk nominal charged provider).
  const paymentPatch: Record<string, unknown> = {
    payment_id: created.paymentId,
    payment_url: created.paymentUrl,
    qr_image_url: created.qrImageUrl,
    payment_expired_at: created.expiresAt,
  };
  if (created.chargedAmount !== null && created.chargedAmount !== undefined) {
    paymentPatch.charged_amount = created.chargedAmount;
  }

  const { data: updated, error: uErr } = await db
    .from("orders")
    .update(paymentPatch)
    .eq("id", order.id)
    .select("*")
    .single<OrderRow>();
  if (uErr || !updated) {
    // Payment sudah hidup di provider — jangan biarkan order PENDING tanpa
    // payment_id (webhook/polling tidak bisa dicocokkan). Tandai gagal.
    log.error("order_payment_ref_update_failed", {
      orderCode: order.order_code,
      paymentId: created.paymentId,
      message: uErr?.message,
    });
    await db
      .from("orders")
      .update({ payment_status: "FAILED", order_status: "EXPIRED" })
      .eq("id", order.id)
      .eq("payment_status", "PENDING");
    throw new HttpError(
      500,
      ErrorCodes.internal,
      "Order dibuat tetapi informasi pembayaran gagal disimpan. Silakan coba lagi atau hubungi penjual.",
    );
  }

  log.info("order_created", {
    orderCode: updated.order_code,
    method,
    total,
    charged: created.chargedAmount,
  });
  return {
    order: updated,
    paymentMethod: method,
    payment: {
      paymentId: created.paymentId,
      paymentUrl: created.paymentUrl,
      qrImageUrl: created.qrImageUrl,
      expiresAt: created.expiresAt,
    },
  };
}

// ---------------------------------------------------------------------------
// BUYER — read own orders (kepemilikan ditegakkan lewat query filter)
// ---------------------------------------------------------------------------

export async function listOrdersForBuyer(accountId: string, limit = 30): Promise<OrderRow[]> {
  const db = await storeDb();
  const { data, error } = await db
    .from("orders")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    log.error("order_list_failed", { message: error.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal memuat daftar order.");
  }
  return (data ?? []) as OrderRow[];
}

export async function getOrderByCodeForBuyer(
  orderCode: string,
  accountId: string,
): Promise<OrderRow | null> {
  const db = await storeDb();
  const { data, error } = await db
    .from("orders")
    .select("*")
    .eq("order_code", orderCode)
    .eq("account_id", accountId)
    .maybeSingle<OrderRow>();
  if (error) log.error("order_get_failed", { message: error.message });
  return data;
}

/** Perbaiki nomor WhatsApp profil (dipakai sebelum checkout). */
export async function updateBuyerWhatsapp(accountId: string, whatsapp: string) {
  const supabase = await accountServer();
  const { error } = await supabase.from("profiles").update({ whatsapp }).eq("id", accountId);
  if (error) {
    log.error("whatsapp_update_failed", { message: error.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal memperbarui nomor WhatsApp.");
  }
}

// ---------------------------------------------------------------------------
// STATUS ENGINE — paid / expired (idempotent)
// ---------------------------------------------------------------------------

async function loadOrderById(db: SupabaseClient, id: string): Promise<OrderRow | null> {
  const { data } = await db.from("orders").select("*").eq("id", id).maybeSingle<OrderRow>();
  return data;
}

function scheduleTelegramNotify(order: OrderRow): void {
  const run = async () => {
    const res = await getNotifier().notifyOrderPaid(buildPaidOrderInfo(order));
    if (!res.ok) {
      // KEBIJAKAN: kegagalan Telegram TIDAK membatalkan PAID, tidak retry otomatis.
      log.warn("telegram_notify_failed", { orderCode: order.order_code, error: res.error });
    }
  };
  try {
    after(run); // kirim setelah response → webhook tidak menahan balasan provider
  } catch {
    void run();
  }
}

/**
 * Tandai order LUNAS. Idempotent: update bersyarat `payment_status in (PENDING, EXPIRED)`
 * hanya berhasil sekali → tidak ada double-process, tidak ada notifikasi ganda.
 *
 * payment_status + order_status + paid_at di-update dalam SATU query atomik
 * agar tidak terjadi payment=PAID tetapi order_status masih PENDING.
 */
export async function applyPaid(
  db: SupabaseClient,
  order: OrderRow,
  opts: { source: PaidSource; chargedAmount?: number | null },
): Promise<{ changed: boolean; reason?: string }> {
  // Validasi nominal dilakukan PEMCALLI sebelum memanggil fungsi ini:
  //  - webhook  → amount WAJIB ada & cocok (handleWebhookEvent)
  //  - polling  → amount dari API privat check-status, dicocokkan bila ada.

  const nowIso = new Date().toISOString();

  // Path A (umum): payment + order status atomik dalam SATU update.
  // Hanya berlaku bila order_status masih PENDING/EXPIRED.
  const atomicPatch: Record<string, unknown> = {
    payment_status: "PAID",
    order_status: "PAID" as OrderStatus,
    paid_at: nowIso,
  };
  if (opts.chargedAmount != null && Number.isFinite(opts.chargedAmount)) {
    atomicPatch.charged_amount = opts.chargedAmount;
  }

  const { data: atomic, error: atomicErr } = await db
    .from("orders")
    .update(atomicPatch)
    .eq("id", order.id)
    .in("payment_status", ["PENDING", "EXPIRED"])
    .in("order_status", ["PENDING", "EXPIRED"])
    .select("*")
    .maybeSingle<OrderRow>();

  if (atomicErr) {
    log.error("apply_paid_failed", { orderCode: order.order_code, message: atomicErr.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal memperbarui pembayaran.");
  }

  let updated: OrderRow | null = atomic;

  if (!updated) {
    // Path B: order_status sudah PROCESSING/DONE (admin lebih dulu) ATAU
    // payment sudah diproses. Coba set payment saja tanpa menyentuh order_status.
    const paymentOnly: Record<string, unknown> = {
      payment_status: "PAID",
      paid_at: nowIso,
    };
    if (opts.chargedAmount != null && Number.isFinite(opts.chargedAmount)) {
      paymentOnly.charged_amount = opts.chargedAmount;
    }
    const { data: payOnly, error: payErr } = await db
      .from("orders")
      .update(paymentOnly)
      .eq("id", order.id)
      .in("payment_status", ["PENDING", "EXPIRED"])
      .select("*")
      .maybeSingle<OrderRow>();
    if (payErr) {
      log.error("apply_paid_failed", { orderCode: order.order_code, message: payErr.message });
      throw new HttpError(500, ErrorCodes.internal, "Gagal memperbarui pembayaran.");
    }
    if (!payOnly) return { changed: false, reason: "already_processed" };
    updated = payOnly;
  }

  const fresh = (await loadOrderById(db, order.id)) ?? updated;

  // Klaim notifikasi HANYA jika Telegram terkonfigurasi. Bila disabled, jangan
  // set telegram_notified_at agar notifikasi bisa dikirim setelah env diisi.
  const { telegramConfigured } = await import("@/lib/env");
  if (telegramConfigured()) {
    const { data: claimed } = await db
      .from("orders")
      .update({ telegram_notified_at: nowIso })
      .eq("id", order.id)
      .is("telegram_notified_at", null)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (claimed) scheduleTelegramNotify(fresh);
  } else {
    log.warn("telegram_skip_unconfigured", { orderCode: order.order_code });
  }

  log.info("order_paid", { orderCode: order.order_code, source: opts.source });
  return { changed: true };
}

export async function applyExpired(db: SupabaseClient, order: OrderRow): Promise<boolean> {
  const { data } = await db
    .from("orders")
    .update({ payment_status: "EXPIRED", order_status: "EXPIRED" as OrderStatus })
    .eq("id", order.id)
    .eq("payment_status", "PENDING")
    .select("id")
    .maybeSingle<{ id: string }>();
  if (data) log.info("order_expired", { orderCode: order.order_code });
  return Boolean(data);
}

/**
 * Webhook/polling memberitahu "berhasil bayar" dengan nominal: validasi
 * terhadap total order + toleransi kode unik YoBasePay sebelum menandai lunas.
 */
export function validateWebhookAmount(
  charged: number | null,
  order: OrderRow,
): { ok: boolean; reason?: string } {
  if (charged === null) {
    return { ok: false, reason: "amount_missing" };
  }
  const env = serverEnv();
  if (!amountWithinTolerance(charged, order.total_amount, env.YOBASEPAY_AMOUNT_TOLERANCE)) {
    return { ok: false, reason: "amount_mismatch" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// REFRESH STATUS (dipakai halaman pembayaran & tombol admin)
// ---------------------------------------------------------------------------

export interface RefreshResult {
  order: OrderRow;
  checkedProvider: boolean;
}

/**
 * Sinkronkan status satu order.
 *  - Dibatasi 1x/10 detik per order (throttle) agar tidak membanjiri provider.
 *  - Sumber kebenaran: jawaban check-status YoBasePay (private API), BUKAN
 *    klaim browser.
 */
export async function refreshOrderStatus(order: OrderRow): Promise<RefreshResult> {
  const db = await storeDb();
  if (order.payment_status !== "PENDING" && order.payment_status !== "EXPIRED") {
    return { order, checkedProvider: false };
  }

  // Pembayaran MANUAL tidak punya provider untuk ditanya: status hanya bisa
  // berubah lewat verifikasi penjual (adminConfirmManualPayment). Di sini
  // cukup tangani kadaluarsa — dan JANGAN expire otomatis bila buyer sudah
  // mengklaim transfer (keputusan ada di penjual: konfirmasi atau tolak).
  // checkedProvider selalu false: memang tidak ada provider yang dihubungi.
  if (isManualMethod(order.payment_method)) {
    if (order.manual_claim_at) return { order, checkedProvider: false };
    const deadline = order.payment_expired_at
      ? Date.parse(order.payment_expired_at) + EXPIRY_GRACE_MS
      : null;
    if (deadline !== null && Date.now() > deadline) {
      await applyExpired(db, order);
      return { order: (await loadOrderById(db, order.id)) ?? order, checkedProvider: false };
    }
    return { order, checkedProvider: false };
  }

  const now = Date.now();
  const last = order.last_payment_checked_at ? Date.parse(order.last_payment_checked_at) : 0;
  if (now - last < PROVIDER_CHECK_THROTTLE_MS) {
    return { order, checkedProvider: false };
  }

  if (!order.payment_id) {
    // Belum ada referensi pembayaran (pembuatan gagal) → expired-kan via clock saja.
    // Tetap catat throttle agar clock-check tidak spam DB.
    await db
      .from("orders")
      .update({ last_payment_checked_at: new Date(now).toISOString() })
      .eq("id", order.id);
    return expireIfPastDeadline(db, order);
  }

  let result;
  try {
    result = await getPaymentProvider().checkStatus(order.payment_id);
  } catch (err) {
    const detail = err instanceof PaymentProviderError ? String(err.detail ?? err.message) : "";
    log.error("provider_check_failed", { orderCode: order.order_code, detail });
    // Provider gagal dihubungi: JANGAN set throttle, biarkan retry segera.
    return { order, checkedProvider: false };
  }

  // Throttle hanya setelah call provider sukses.
  await db
    .from("orders")
    .update({ last_payment_checked_at: new Date(now).toISOString() })
    .eq("id", order.id);

  switch (result.state) {
    case "paid": {
      if (result.amount !== null && !validateWebhookAmount(result.amount, order).ok) {
        log.error("polling_amount_mismatch", { orderCode: order.order_code, charged: result.amount });
        return { order: (await loadOrderById(db, order.id)) ?? order, checkedProvider: true };
      }
      await applyPaid(db, order, { source: "polling", chargedAmount: result.amount });
      break;
    }
    case "expired":
    case "failed":
      await applyExpired(db, order);
      break;
    default:
      return expireIfPastDeadline(db, order);
  }
  return { order: (await loadOrderById(db, order.id)) ?? order, checkedProvider: true };
}

async function expireIfPastDeadline(db: SupabaseClient, order: OrderRow): Promise<RefreshResult> {
  if (order.payment_expired_at && Date.now() > Date.parse(order.payment_expired_at) + EXPIRY_GRACE_MS) {
    await applyExpired(db, order);
    return { order: (await loadOrderById(db, order.id)) ?? order, checkedProvider: true };
  }
  return { order, checkedProvider: true };
}

// ---------------------------------------------------------------------------
// WEBHOOK entry
// ---------------------------------------------------------------------------

export interface WebhookOutcome {
  /** Untuk response & log; tidak memuat data sensitif. */
  handled: "paid" | "expired" | "ignored";
  reason?: string;
}

export async function handleWebhookEvent(params: {
  provider: PaymentProvider;
  paymentId: string | null;
  orderCode: string | null;
  state: string;
  amount: number | null;
}): Promise<WebhookOutcome> {
  const db = await storeDb();
  let order: OrderRow | null = null;
  if (params.paymentId) {
    const { data } = await db
      .from("orders")
      .select("*")
      .eq("payment_id", params.paymentId)
      .maybeSingle<OrderRow>();
    order = data;
  }
  if (!order && params.orderCode) {
    const { data } = await db
      .from("orders")
      .select("*")
      .eq("order_code", params.orderCode)
      .maybeSingle<OrderRow>();
    order = data;
  }
  if (!order) {
    log.warn("webhook_order_not_found", { paymentId: params.paymentId ?? undefined });
    return { handled: "ignored", reason: "order_not_found" };
  }

  switch (params.state) {
    case "paid": {
      const check = validateWebhookAmount(params.amount, order);
      if (!check.ok) {
        // Nominal tak cocok/hilang → JANGAN tandai lunas dari webhook.
        // Status tetap akan tersinkron oleh pengecekan status server-side.
        log.error("webhook_amount_invalid", {
          orderCode: order.order_code,
          reason: check.reason,
          charged: params.amount,
        });
        return { handled: "ignored", reason: check.reason };
      }
      const res = await applyPaid(db, order, {
        source: "webhook",
        chargedAmount: params.amount,
      });
      return { handled: "paid", reason: res.changed ? undefined : res.reason };
    }
    case "expired":
    case "failed": {
      const changed = await applyExpired(db, order);
      return { handled: "expired", reason: changed ? undefined : "already_processed" };
    }
    default:
      log.warn("webhook_unknown_status", { orderCode: order.order_code });
      return { handled: "ignored", reason: "status_unknown" };
  }
}

// ---------------------------------------------------------------------------
// PEMBAYARAN MANUAL (QRIS statis penjual) — klaim buyer & verifikasi penjual
// ---------------------------------------------------------------------------
/**
 * Buyer menyatakan "saya sudah transfer".
 *
 * PENTING: ini BUKAN bukti pembayaran dan TIDAK mengubah payment_status.
 * Klaim hanya memindahkan order ke antrian verifikasi penjual (plus notifikasi
 * Telegram). Status PAID tetap hanya bisa di-set penjual lewat
 * adminConfirmManualPayment() setelah mencocokkan mutasi.
 *
 * Idempotent: klaim kedua tidak menimpa klaim pertama (guard `.is(null)`).
 */
export async function claimManualPayment(
  order: OrderRow,
  input: { note?: string; reference?: string },
): Promise<{ order: OrderRow; changed: boolean }> {
  if (!isManualMethod(order.payment_method)) {
    throw new HttpError(
      409,
      ErrorCodes.conflict,
      "Order ini memakai QRIS otomatis — statusnya terdeteksi sistem, tidak perlu konfirmasi manual.",
    );
  }
  if (order.payment_status === "PAID") {
    throw new HttpError(409, ErrorCodes.conflict, "Pembayaran sudah diverifikasi penjual.");
  }
  if (order.payment_status !== "PENDING") {
    throw new HttpError(
      409,
      ErrorCodes.conflict,
      "Pembayaran sudah ditutup (kadaluarsa/gagal). Silakan buat order baru.",
    );
  }

  const db = await storeDb();
  if (order.manual_claim_at) {
    // Sudah pernah diklaim → tidak apa-apa (tombol dobel / reload).
    return { order, changed: false };
  }

  const { data, error } = await db
    .from("orders")
    .update({
      manual_claim_at: new Date().toISOString(),
      manual_claim_note: input.note ?? "",
      manual_claim_reference: input.reference ?? "",
      // Bersihkan jejak penolakan sebelumnya agar UI buyer kembali bersih.
      manual_review_status: null,
      manual_reviewed_at: null,
      manual_reviewed_by: null,
      manual_review_note: "",
    })
    .eq("id", order.id)
    .eq("payment_status", "PENDING")
    .is("manual_claim_at", null)
    .select("*")
    .maybeSingle<OrderRow>();
  if (error) {
    log.error("manual_claim_failed", { orderCode: order.order_code, message: error.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal mencatat konfirmasi pembayaran.");
  }
  if (!data) {
    // Balapan: sudah diklaim / status berubah. Ambil ulang, jangan error.
    return { order: (await loadOrderById(db, order.id)) ?? order, changed: false };
  }

  // Notifikasi penjual (sekali per klaim) — gagal kirim TIDAK membatalkan klaim.
  const { telegramConfigured } = await import("@/lib/env");
  if (telegramConfigured()) {
    const { data: claimed } = await db
      .from("orders")
      .update({ manual_claim_notified_at: new Date().toISOString() })
      .eq("id", order.id)
      .is("manual_claim_notified_at", null)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (claimed) scheduleManualClaimNotify(data);
  }

  log.info("manual_claim_received", { orderCode: order.order_code });
  return { order: data, changed: true };
}

function scheduleManualClaimNotify(order: OrderRow): void {
  const run = async () => {
    const res = await getNotifier().notifyManualPaymentClaim(buildManualClaimInfo(order));
    if (!res.ok) {
      log.warn("telegram_notify_failed", {
        orderCode: order.order_code,
        kind: "manual_claim",
        error: res.error,
      });
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * Penjual mengonfirmasi uang sudah masuk (dilihat dari mutasi/QRIS merchant).
 * Satu-satunya jalan order manual menjadi PAID.
 */
export async function adminConfirmManualPayment(
  orderId: string,
  actor: AuthContext,
  input: { receivedAmount?: number | null; note?: string } = {},
): Promise<OrderRow> {
  const db = await storeDb();
  const order = await getAdminOrder(orderId);
  if (!order) throw new HttpError(404, ErrorCodes.notFound, "Order tidak ditemukan.");
  if (!isManualMethod(order.payment_method)) {
    throw new HttpError(
      409,
      ErrorCodes.conflict,
      "Order ini bukan pembayaran manual — statusnya diverifikasi otomatis oleh provider.",
    );
  }
  if (order.payment_status === "PAID") {
    throw new HttpError(409, ErrorCodes.conflict, "Pembayaran sudah diverifikasi sebelumnya.");
  }

  const expected = order.charged_amount ?? order.total_amount;
  const received =
    input.receivedAmount === null || input.receivedAmount === undefined
      ? null
      : Math.trunc(input.receivedAmount);
  if (received !== null) {
    if (!Number.isFinite(received) || received <= 0) {
      throw new HttpError(400, ErrorCodes.validation, "Nominal masuk tidak valid.");
    }
    if (received < order.total_amount) {
      throw new HttpError(
        409,
        ErrorCodes.conflict,
        "Nominal masuk lebih kecil dari total order. Jangan konfirmasi bila uang belum penuh.",
      );
    }
    if (received > expected) {
      log.warn("manual_overpayment", {
        orderCode: order.order_code,
        expected,
        received,
        by: actor.user.id,
      });
    }
  }

  const nowIso = new Date().toISOString();
  const reviewPatch: Record<string, unknown> = {
    manual_review_status: "APPROVED",
    manual_reviewed_at: nowIso,
    manual_reviewed_by: actor.user.id,
    manual_review_note: input.note ?? "",
  };
  if (received !== null) reviewPatch.charged_amount = received;

  const { error } = await db.from("orders").update(reviewPatch).eq("id", orderId);
  if (error) {
    log.error("manual_review_failed", { orderCode: order.order_code, message: error.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal menyimpan verifikasi pembayaran.");
  }

  // Status PAID lewat jalur yang sama dengan webhook (idempotent + Telegram).
  await applyPaid(db, order, { source: "manual", chargedAmount: received ?? expected });
  log.info("manual_payment_confirmed", {
    orderCode: order.order_code,
    by: actor.user.id,
    received,
  });
  const fresh = await loadOrderById(db, orderId);
  return fresh ?? order;
}

/**
 * Penjual menolak klaim buyer (mutasi tidak ditemukan). Klaim dibersihkan agar
 * buyer bisa konfirmasi ulang; order tetap PENDING sampai batas waktu habis.
 */
export async function adminRejectManualClaim(
  orderId: string,
  actor: AuthContext,
  input: { note?: string } = {},
): Promise<OrderRow> {
  const db = await storeDb();
  const order = await getAdminOrder(orderId);
  if (!order) throw new HttpError(404, ErrorCodes.notFound, "Order tidak ditemukan.");
  if (!isManualMethod(order.payment_method)) {
    throw new HttpError(409, ErrorCodes.conflict, "Order ini bukan pembayaran manual.");
  }
  if (!order.manual_claim_at) {
    throw new HttpError(409, ErrorCodes.conflict, "Belum ada konfirmasi pembayaran dari buyer.");
  }
  if (order.payment_status === "PAID") {
    throw new HttpError(409, ErrorCodes.conflict, "Pembayaran sudah diverifikasi — tidak bisa ditolak.");
  }

  const { data, error } = await db
    .from("orders")
    .update({
      manual_claim_at: null,
      manual_claim_note: "",
      manual_claim_reference: "",
      manual_claim_notified_at: null,
      manual_review_status: "REJECTED",
      manual_reviewed_at: new Date().toISOString(),
      manual_reviewed_by: actor.user.id,
      manual_review_note: input.note ?? "",
    })
    .eq("id", orderId)
    .is("payment_status", "PENDING")
    .select("*")
    .maybeSingle<OrderRow>();
  if (error || !data) {
    throw new HttpError(
      409,
      ErrorCodes.conflict,
      "Status order baru saja berubah. Muat ulang halaman.",
    );
  }
  log.info("manual_claim_rejected", { orderCode: order.order_code, by: actor.user.id });
  return data;
}

// ---------------------------------------------------------------------------
// ADMIN — list, detail, transisi status manual (state machine)
// ---------------------------------------------------------------------------

const ADMIN_ALLOWED_TRANSITIONS: Record<"process" | "complete" | "expire", OrderStatus[]> = {
  // PAID → PROCESSING → DONE ; PAID → DONE (langsung)
  process: ["PAID"],
  complete: ["PAID", "PROCESSING"],
  // PENDING → EXPIRED (pembatalan order mati oleh admin)
  expire: ["PENDING"],
};

export async function listAdminOrders(filter: {
  status?: OrderStatus;
  q?: string;
  /** true = hanya order pembayaran manual yang menunggu verifikasi penjual. */
  manualClaim?: boolean;
}): Promise<AdminOrderView[]> {
  const db = await storeDb();
  let query = db.from("orders").select("*").order("created_at", { ascending: false }).limit(200);
  if (filter.status) query = query.eq("order_status", filter.status);
  if (filter.manualClaim) {
    query = query
      .eq("payment_method", PAYMENT_METHOD_MANUAL)
      .eq("payment_status", "PENDING")
      .not("manual_claim_at", "is", null)
      .order("manual_claim_at", { ascending: true });
  }
  if (filter.q) {
    const { sanitizeAdminSearchQuery } = await import("@/lib/validation");
    const cleaned = sanitizeAdminSearchQuery(filter.q);
    if (cleaned) {
      // Escape sisa metakarakter LIKE; karakter filter PostgREST sudah dibuang.
      const like = `%${cleaned.replace(/[%_]/g, "")}%`;
      // bungkus nilai dengan kutip ganda agar koma/spasi tidak memecah .or()
      const quoted = `"${like.replace(/"/g, "")}"`;
      query = query.or(
        `order_code.ilike.${quoted},buyer_name_snapshot.ilike.${quoted},product_name_snapshot.ilike.${quoted}`,
      );
    }
  }
  const { data, error } = await query;
  if (error) {
    log.error("admin_order_list_failed", { message: error.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal memuat daftar order.");
  }
  return (data ?? []) as AdminOrderView[];
}

export async function getAdminOrder(orderId: string): Promise<AdminOrderView | null> {
  const db = await storeDb();
  const { data } = await db.from("orders").select("*").eq("id", orderId).maybeSingle<AdminOrderView>();
  return data;
}

/** Cari order via UUID internal ATAU order_code publik (untuk admin). */
export async function findOrderByCodeOrId(codeOrId: string): Promise<AdminOrderView | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(codeOrId);
  const db = await storeDb();
  const column = isUuid ? "id" : "order_code";
  const { data } = await db
    .from("orders")
    .select("*")
    .eq(column, codeOrId)
    .maybeSingle<AdminOrderView>();
  return data;
}

export async function adminTransition(
  orderId: string,
  action: keyof typeof ADMIN_ALLOWED_TRANSITIONS,
  actor: AuthContext,
): Promise<OrderRow> {
  const db = await storeDb();
  const order = await getAdminOrder(orderId);
  if (!order) throw new HttpError(404, ErrorCodes.notFound, "Order tidak ditemukan.");

  const allowedFrom = ADMIN_ALLOWED_TRANSITIONS[action];
  if (!allowedFrom.includes(order.order_status)) {
    throw new HttpError(
      409,
      ErrorCodes.conflict,
      `Aksi tidak berlaku untuk status ${order.order_status}. Muat ulang halaman.`,
    );
  }
  if (action !== "expire" && order.payment_status !== "PAID") {
    throw new HttpError(409, ErrorCodes.conflict, "Pembayaran belum lunas — pesanan belum bisa diproses.");
  }

  const to: OrderStatus =
    action === "process" ? "PROCESSING" : action === "complete" ? "DONE" : "EXPIRED";
  const patch: Record<string, unknown> = { order_status: to };
  if (action === "expire") patch.payment_status = "EXPIRED";

  // Update bersyarat: status belum berubah oleh proses lain (race-safe).
  const { data, error } = await db
    .from("orders")
    .update(patch)
    .eq("id", orderId)
    .in("order_status", allowedFrom)
    .select("*")
    .single<OrderRow>();
  if (error || !data) {
    throw new HttpError(409, ErrorCodes.conflict, "Status order baru saja berubah. Muat ulang halaman.");
  }
  log.info("admin_transition", { orderCode: order.order_code, action, by: actor.user.id, to });
  return data;
}

// ---------------------------------------------------------------------------
// ADMIN — statistik dashboard
// ---------------------------------------------------------------------------

export interface AdminStats {
  ordersToday: number;
  needProcessing: number; // PAID, menunggu disiapkan
  processing: number;
  pendingPayment: number;
  /** Pembayaran manual yang sudah diklaim buyer, menunggu cek mutasi. */
  needVerification: number;
  doneToday: number;
  revenueMonth: number; // rupiah, dari order PAID+
}

export async function getAdminStats(): Promise<AdminStats> {
  const db = await storeDb();
  const { jakartaDayStartISO, jakartaMonthStartISO } = await import("@/lib/dates");
  const dayStart = jakartaDayStartISO();
  const monthStart = jakartaMonthStartISO();

  const [a, b, c, d, e, f, g] = await Promise.all([
    db.from("orders").select("id", { count: "exact", head: true }).gte("created_at", dayStart),
    db.from("orders").select("id", { count: "exact", head: true }).eq("order_status", "PAID"),
    db.from("orders").select("id", { count: "exact", head: true }).eq("order_status", "PROCESSING"),
    db.from("orders").select("id", { count: "exact", head: true }).eq("order_status", "PENDING"),
    db.from("orders").select("id", { count: "exact", head: true }).eq("order_status", "DONE").gte("updated_at", dayStart),
    db.from("orders").select("total_amount").in("payment_status", ["PAID"]).gte("paid_at", monthStart),
    db
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("payment_method", PAYMENT_METHOD_MANUAL)
      .eq("payment_status", "PENDING")
      .not("manual_claim_at", "is", null),
  ]);
  for (const r of [a, b, c, d, e, f, g]) {
    if (r.error) log.error("admin_stats_failed", { message: r.error.message });
  }
  const revenue = ((f.data ?? []) as { total_amount: number }[]).reduce(
    (s, row) => s + Number(row.total_amount),
    0,
  );
  return {
    ordersToday: a.count ?? 0,
    needProcessing: b.count ?? 0,
    processing: c.count ?? 0,
    pendingPayment: d.count ?? 0,
    needVerification: g.count ?? 0,
    doneToday: e.count ?? 0,
    revenueMonth: revenue,
  };
}

/** Lookup profil buyer oleh admin (email utk dashboard) — via service role akun. */
export async function getProfileForAdmin(accountId: string) {
  const admin = await accountAdmin();
  const { data } = await admin
    .from("profiles")
    .select("id,name,email,whatsapp,role,created_at")
    .eq("id", accountId)
    .maybeSingle();
  return data as { id: string; name: string; email: string; whatsapp: string; role: string; created_at: string } | null;
}
