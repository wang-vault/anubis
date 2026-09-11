import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ErrorCodes, HttpError } from "@/lib/api";
import { accountAdmin, accountServer, storeDb } from "@/lib/supabase/server";
import { getPaymentProvider } from "@/lib/integrations/payment";
import {
  PaymentProviderError,
  type PaymentProvider,
} from "@/lib/integrations/payment/types";
import { buildPaidOrderInfo, getNotifier } from "@/lib/integrations/telegram";
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

export type PaidSource = "webhook" | "polling";

// ---------------------------------------------------------------------------
// BUYER — create order + payment
// ---------------------------------------------------------------------------

export interface CreateOrderResult {
  order: OrderRow;
  payment: {
    paymentId: string;
    paymentUrl: string | null;
    qrImageUrl: string | null;
    expiresAt: string | null;
  };
}

export async function createOrderForBuyer(
  ctx: AuthContext,
  input: { productId: string; quantity: number; whatsappOverride?: string },
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

  // 4. Buat pembayaran di YoBasePay (server-side; API key tak pernah ke browser).
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

  // 5. Simpan referensi pembayaran pada order.
  const { data: updated, error: uErr } = await db
    .from("orders")
    .update({
      payment_id: created.paymentId,
      payment_url: created.paymentUrl,
      qr_image_url: created.qrImageUrl,
      payment_expired_at: created.expiresAt,
    })
    .eq("id", order.id)
    .select("*")
    .single<OrderRow>();
  if (uErr || !updated) {
    log.error("order_payment_ref_update_failed", {
      orderCode: order.order_code,
      message: uErr?.message,
    });
    throw new HttpError(
      500,
      ErrorCodes.internal,
      "Order dibuat tetapi informasi pembayaran gagal disimpan. Hubungi penjual.",
    );
  }

  log.info("order_created", { orderCode: updated.order_code, total });
  return {
    order: updated,
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
 */
export async function applyPaid(
  db: SupabaseClient,
  order: OrderRow,
  opts: { source: PaidSource },
): Promise<{ changed: boolean; reason?: string }> {
  // Validasi nominal dilakukan PEMCALLI sebelum memanggil fungsi ini:
  //  - webhook  → amount WAJIB ada & cocok (handleWebhookEvent)
  //  - polling  → amount dari API privat check-status, dicocokkan bila ada.

  const { data: updated, error } = await db
    .from("orders")
    .update({ payment_status: "PAID", paid_at: new Date().toISOString() })
    .eq("id", order.id)
    .in("payment_status", ["PENDING", "EXPIRED"])
    .select("*")
    .maybeSingle<OrderRow>();

  if (error) {
    log.error("apply_paid_failed", { orderCode: order.order_code, message: error.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal memperbarui pembayaran.");
  }
  if (!updated) return { changed: false, reason: "already_processed" };

  // Sinkronkan status pesanan (hanya dari PENDING/EXPIRED — jangan turunkan
  // DONE/PROCESSING yang sudah di-set manual bila ada balasan telat).
  await db
    .from("orders")
    .update({ order_status: "PAID" as OrderStatus })
    .eq("id", order.id)
    .in("order_status", ["PENDING", "EXPIRED"]);

  const fresh = (await loadOrderById(db, order.id)) ?? updated;

  // Klaim notifikasi (anti-duplikat lintas webhook retry / polling paralel).
  const { data: claimed } = await db
    .from("orders")
    .update({ telegram_notified_at: new Date().toISOString() })
    .eq("id", order.id)
    .is("telegram_notified_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (claimed) scheduleTelegramNotify(fresh);

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

  const now = Date.now();
  const last = order.last_payment_checked_at ? Date.parse(order.last_payment_checked_at) : 0;
  if (now - last < PROVIDER_CHECK_THROTTLE_MS) {
    return { order, checkedProvider: false };
  }
  await db.from("orders").update({ last_payment_checked_at: new Date(now).toISOString() }).eq("id", order.id);

  if (!order.payment_id) {
    // Belum ada referensi pembayaran (pembuatan gagal) → expired-kan via clock saja.
    return expireIfPastDeadline(db, order);
  }

  let result;
  try {
    result = await getPaymentProvider().checkStatus(order.payment_id);
  } catch (err) {
    const detail = err instanceof PaymentProviderError ? String(err.detail ?? err.message) : "";
    log.error("provider_check_failed", { orderCode: order.order_code, detail });
    // Provider tidak bisa dihubungi: jangan ubah status, biarkan buyer mencoba lagi.
    return { order, checkedProvider: false };
  }

  switch (result.state) {
    case "paid": {
      if (result.amount !== null && !validateWebhookAmount(result.amount, order).ok) {
        log.error("polling_amount_mismatch", { orderCode: order.order_code, charged: result.amount });
        return { order: (await loadOrderById(db, order.id)) ?? order, checkedProvider: true };
      }
      await applyPaid(db, order, { source: "polling" });
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
      const res = await applyPaid(db, order, { source: "webhook" });
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
}): Promise<AdminOrderView[]> {
  const db = await storeDb();
  let query = db.from("orders").select("*").order("created_at", { ascending: false }).limit(200);
  if (filter.status) query = query.eq("order_status", filter.status);
  if (filter.q) {
    const like = `%${filter.q.replace(/[%_]/g, "")}%`;
    query = query.or(`order_code.ilike.${like},buyer_name_snapshot.ilike.${like},product_name_snapshot.ilike.${like}`);
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
  const { data } = await db
    .from("orders")
    .select("*")
    [isUuid ? "eq" : "eq"](isUuid ? "id" : "order_code", codeOrId)
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
  doneToday: number;
  revenueMonth: number; // rupiah, dari order PAID+
}

export async function getAdminStats(): Promise<AdminStats> {
  const db = await storeDb();
  const { jakartaDayStartISO, jakartaMonthStartISO } = await import("@/lib/dates");
  const dayStart = jakartaDayStartISO();
  const monthStart = jakartaMonthStartISO();

  const [a, b, c, d, e, f] = await Promise.all([
    db.from("orders").select("id", { count: "exact", head: true }).gte("created_at", dayStart),
    db.from("orders").select("id", { count: "exact", head: true }).eq("order_status", "PAID"),
    db.from("orders").select("id", { count: "exact", head: true }).eq("order_status", "PROCESSING"),
    db.from("orders").select("id", { count: "exact", head: true }).eq("order_status", "PENDING"),
    db.from("orders").select("id", { count: "exact", head: true }).eq("order_status", "DONE").gte("updated_at", dayStart),
    db.from("orders").select("total_amount").in("payment_status", ["PAID"]).gte("paid_at", monthStart),
  ]);
  for (const r of [a, b, c, d, e, f]) {
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
