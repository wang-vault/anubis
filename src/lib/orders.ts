import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ErrorCodes, HttpError } from "@/lib/api";
import { accountAdmin, accountServer, storeDb } from "@/lib/supabase/server";
import { getManualPaymentView, resolvePaymentMethod } from "@/lib/payment-config";
import {
  PAYMENT_METHOD_MANUAL,
  isManualMethod,
  manualChargedAmount,
  type PaymentMethod,
} from "@/lib/payment-methods";
import {
  buildManualClaimInfo,
  buildPaidOrderInfo,
  getNotifier,
} from "@/lib/integrations/telegram";
import { generateOrderCode } from "@/lib/order-code";
import { log } from "@/lib/logger";
import {
  BASE_ORDER_SELECT,
  MANUAL_PAYMENT_MIGRATION_FILE,
  WHATSAPP_PAYMENT_MIGRATION_FILE,
  describeDbError,
  isMissingColumnError,
  isManualPaymentSchemaReady,
  normalizeOrderRow,
  resetStoreSchemaCache,
} from "@/lib/store-schema";
import type { AuthContext } from "@/lib/authz";
import type { AdminOrderView, OrderRow, OrderStatus, ProductRow } from "@/lib/types";

/**
 * ===========================================================================
 * DOMAIN LOGIC ORDER — satu-satunya tempat status order boleh berubah.
 * ===========================================================================
 * Prinsip:
 *  - Harga & total SELALU dihitung server-side dari DB store (client tidak dipercaya).
 *  - Satu-satunya jalur pembayaran adalah TRANSFER MANUAL yang dikoordinasikan
 *    lewat WhatsApp; order menjadi PAID HANYA setelah penjual memverifikasi
 *    mutasi dari dashboard (adminConfirmManualPayment). Klaim buyer ("saya
 *    sudah transfer") cuma memindahkan order ke antrian verifikasi.
 *  - Semua transisi status idempotent (guard `where` di query update).
 *  - Notifikasi Telegram diklaim sekali per order (telegram_notified_at).
 *
 * Tidak ada integrasi provider pembayaran / webhook lagi — jejaknya sudah
 * dihapus dari kode. Order ARSIP yang bernilai 'STENLY'/'YOBASEPAY' tetap
 * terbaca di dashboard apa adanya, tanpa diperlakukan khusus.
 */

/** Grasi otomatis-expire setelah batas waktu bayar order manual. */
const EXPIRY_GRACE_MS = 30_000;

export type PaidSource = "manual";

/** Hasil query daftar orders (bentuk yang dipakai semua jalur fallback skema). */
interface OrdersQueryResult {
  data: OrderRow[] | null;
  error: { message: string; code?: string } | null;
}

// ---------------------------------------------------------------------------
// BUYER — create order + payment
// ---------------------------------------------------------------------------

export interface CreateOrderResult {
  order: OrderRow;
  paymentMethod: PaymentMethod;
  payment: {
    /** Batas waktu bayar order (dari pengaturan penjual). */
    expiresAt: string | null;
    /** Nomor WhatsApp penjual tujuan chat buyer (null bila belum diatur). */
    sellerWhatsapp: string | null;
  };
}

export async function createOrderForBuyer(
  ctx: AuthContext,
  input: {
    productId: string;
    quantity: number;
    whatsappOverride?: string;
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

  // 2b. Metode bayar: SATU-SATUNYA metode adalah transfer manual via WhatsApp.
  //     Nilai apa pun dari klien diabaikan; boleh/tidaknya ditentukan
  //     konfigurasi SERVER (env + pengaturan penjual).
  const method = await resolvePaymentMethod();

  // 2c. Skema database: pembayaran manual butuh kolom manual_* di orders +
  //     kolom nomor WhatsApp di manual_payment_settings. Bila penjual belum
  //     menjalankan migrasi, tolak dengan pesan jelas — jangan membuat order
  //     yang tidak akan pernah bisa dibayar/diverifikasi.
  const schemaReady = await isManualPaymentSchemaReady();
  if (!schemaReady) {
    log.error("manual_payment_schema_missing", {
      message: "kolom pembayaran manual / nomor WhatsApp belum ada di database store",
      migrations: [MANUAL_PAYMENT_MIGRATION_FILE, WHATSAPP_PAYMENT_MIGRATION_FILE],
    });
    throw new HttpError(
      503,
      ErrorCodes.paymentUnavailable,
      "Pembayaran manual sedang tidak tersedia. Silakan hubungi penjual.",
    );
  }

  // 3. Insert order PENDING dengan kode publik unik (retry jika tabrakan).
  let order: OrderRow | null = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    const payload: Record<string, unknown> = {
      order_code: generateOrderCode(),
      account_id: ctx.user.id,
      product_id: product.id,
      product_name_snapshot: product.name,
      unit_price_snapshot: product.price,
      quantity: input.quantity,
      total_amount: total,
      payment_status: "PENDING",
      order_status: "PENDING",
      payment_method: method,
      buyer_name_snapshot: profile.name,
      buyer_whatsapp_snapshot: input.whatsappOverride ?? profile.whatsapp,
      buyer_email_snapshot: ctx.user.email ?? profile.email,
    };

    const { data, error } = await db
      .from("orders")
      .insert(payload)
      .select("*")
      .single<OrderRow>();
    if (!error) {
      order = normalizeOrderRow(data);
      break;
    }
    if (isMissingColumnError(error)) {
      // Probe skema ternyata basi (kolom hilang setelah dicek) → buang cache
      // supaya permintaan berikutnya memeriksa ulang, lalu beri pesan jelas.
      resetStoreSchemaCache();
      log.error("order_insert_schema_gap", { message: error.message, method });
      throw new HttpError(
        503,
        ErrorCodes.paymentUnavailable,
        "Pembayaran sedang tidak tersedia. Silakan hubungi penjual.",
      );
    }
    if (error.code !== "23505") {
      log.error("order_insert_failed", { message: error.message });
      throw new HttpError(500, ErrorCodes.internal, "Gagal membuat order.");
    }
  }
  if (!order) {
    throw new HttpError(500, ErrorCodes.internal, "Gagal membuat order, coba lagi.");
  }

  // 4. Nominal & batas waktu bayar untuk order manual:
  //    nominal = total + kode unik (deterministik dari order_code) supaya mutasi
  //    mudah dicocokkan penjual; batas waktu dari pengaturan penjual.
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

  const manualRow = normalizeOrderRow(manualOrder);
  log.info("order_created", {
    orderCode: manualRow.order_code,
    method,
    total,
    charged: manualRow.charged_amount,
  });
  return {
    order: manualRow,
    paymentMethod: method,
    payment: {
      expiresAt: manualRow.payment_expired_at,
      sellerWhatsapp: manual.whatsappNumber,
    },
  };
}

// ---------------------------------------------------------------------------
// BUYER — read own orders (kepemilikan ditegakkan lewat query filter)
// ---------------------------------------------------------------------------

export async function listOrdersForBuyer(accountId: string, limit = 30): Promise<OrderRow[]> {
  const db = await storeDb();
  // Catatan tipe: daftar kolom berupa variabel → supabase-js tidak bisa
  // menebak bentuk baris (hanya literal "*" yang di-infer), jadi hasilnya
  // di-cast eksplisit ke OrderRow.
  const run = async (columns: string): Promise<OrdersQueryResult> => {
    const res = await db
      .from("orders")
      .select(columns)
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return { data: res.data as unknown as OrderRow[] | null, error: res.error };
  };

  let { data, error } = await run("*");
  // `select=*` bisa ditolak bila schema cache PostgREST menyebut kolom yang
  // tidak ada di tabel → ulang dengan daftar kolom dasar (tanpa kolom manual).
  if (error && isMissingColumnError(error)) {
    resetStoreSchemaCache();
    log.warn("order_list_schema_gap", {
      message: describeDbError(error),
      migration: MANUAL_PAYMENT_MIGRATION_FILE,
    });
    ({ data, error } = await run(BASE_ORDER_SELECT));
  }
  if (error) {
    log.error("order_list_failed", { message: describeDbError(error), code: error.code ?? null });
    throw new HttpError(500, ErrorCodes.internal, "Gagal memuat daftar order.");
  }
  return ((data ?? []) as OrderRow[]).map(normalizeOrderRow);
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
  return data ? normalizeOrderRow(data) : null;
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
  return data ? normalizeOrderRow(data) : null;
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
    after(run); // kirim setelah response → tidak menahan balasan ke buyer/admin
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
  // Nominal yang benar-benar masuk divalidasi PEMCALLI sebelum memanggil
  // fungsi ini (adminConfirmManualPayment menolak transfer kurang dari total).

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

// ---------------------------------------------------------------------------
// REFRESH STATUS (dipakai halaman pembayaran & tombol muat ulang buyer)
// ---------------------------------------------------------------------------

export interface RefreshResult {
  order: OrderRow;
}

/**
 * Sinkronkan status satu order.
 *
 * Pembayaran manual tidak punya provider untuk ditanya: status hanya bisa
 * berubah lewat verifikasi penjual (adminConfirmManualPayment). Yang dikerjakan
 * di sini cuma satu — menandai order KADALUARSA setelah batas waktu bayar
 * terlewat, dan itu pun TIDAK dilakukan bila buyer sudah mengklaim transfer
 * (keputusan ada di penjual: konfirmasi atau tolak).
 */
export async function refreshOrderStatus(order: OrderRow): Promise<RefreshResult> {
  if (order.payment_status !== "PENDING") return { order };
  if (order.manual_claim_at) return { order };

  const db = await storeDb();
  const deadline = order.payment_expired_at
    ? Date.parse(order.payment_expired_at) + EXPIRY_GRACE_MS
    : null;
  if (deadline === null || Date.now() <= deadline) return { order };

  await applyExpired(db, order);
  return { order: (await loadOrderById(db, order.id)) ?? order };
}

// ---------------------------------------------------------------------------
// PEMBAYARAN MANUAL (WhatsApp) — klaim buyer & verifikasi penjual
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
      "Order arsip ini memakai QRIS otomatis (sudah tidak dipakai lagi), jadi tidak perlu konfirmasi manual.",
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
      "Order arsip ini bukan pembayaran manual — statusnya tidak bisa diverifikasi dari sini.",
    );
  }
  if (order.payment_status === "PAID") {
    throw new HttpError(409, ErrorCodes.conflict, "Pembayaran sudah diverifikasi sebelumnya.");
  }
  // Hanya order yang masih menunggu (atau telanjur kadaluarsa) yang bisa
  // dikonfirmasi. Tanpa guard ini, mengonfirmasi order FAILED akan menandai
  // review APPROVED padahal update pembayarannya tidak pernah terjadi
  // (applyPaid hanya menyentuh PENDING/EXPIRED) — data jadi tidak konsisten.
  if (order.payment_status !== "PENDING" && order.payment_status !== "EXPIRED") {
    throw new HttpError(
      409,
      ErrorCodes.conflict,
      `Status pembayaran ${order.payment_status} tidak bisa dikonfirmasi dari dashboard.`,
    );
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
    throw new HttpError(409, ErrorCodes.conflict, "Order arsip ini bukan pembayaran manual.");
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
    // Guard race-safe: HARUS `.eq` — `.is` di PostgREST hanya untuk null/boolean
    // (`payment_status=is.PENDING` ditolak server sebagai error 22P02).
    .eq("payment_status", "PENDING")
    .select("*")
    .maybeSingle<OrderRow>();
  if (error || !data) {
    log.error("manual_claim_reject_failed", {
      orderCode: order.order_code,
      message: error?.message,
    });
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

  // Antrian verifikasi manual menyaring kolom payment_method/manual_claim_at.
  // Bila database belum di-migrasi, kembalikan daftar kosong (dashboard tetap
  // tampil) alih-alih melempar 500 yang membuat seluruh halaman jadi
  // "Application error". Banner di /admin menampilkan SQL yang harus dijalankan.
  const supportsManual = filter.manualClaim ? await isManualPaymentSchemaReady() : true;
  if (filter.manualClaim && !supportsManual) {
    log.warn("admin_manual_queue_unavailable", {
      reason: "kolom pembayaran manual belum ada di database store",
      migration: MANUAL_PAYMENT_MIGRATION_FILE,
    });
    return [];
  }

  const runQuery = async (columns: string, withManualFilters: boolean): Promise<OrdersQueryResult> => {
    let query = db.from("orders").select(columns).order("created_at", { ascending: false }).limit(200);
    if (filter.status) query = query.eq("order_status", filter.status);
    if (withManualFilters) {
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
    const res = await query;
    return { data: res.data as unknown as OrderRow[] | null, error: res.error };
  };

  // Filter antrian manual HANYA untuk permintaan antrian manual. `supportsManual`
  // sekadar menandai "kolom manual ada di database" — memakainya langsung di sini
  // membuat SEMUA daftar order (mis. /admin/orders tanpa filter) ikut disaring
  // `payment_method = MANUAL and manual_claim_at is not null`, sehingga daftar
  // order tampil kosong pada database yang justru sudah di-migrasi.
  let { data, error } = await runQuery("*", Boolean(filter.manualClaim) && supportsManual);

  // Jaring pengaman kedua: skema bisa tidak cocok walau probe lolos (kolom
  // dihapus setelah dicek, atau schema cache PostgREST basi sehingga `select=*`
  // ikut menyebut kolom yang tidak ada). Ulangi dengan daftar kolom dasar
  // tanpa filter manual sebelum menyerah dengan 500.
  if (error && isMissingColumnError(error)) {
    resetStoreSchemaCache();
    log.warn("admin_order_list_schema_gap", {
      message: describeDbError(error),
      migration: MANUAL_PAYMENT_MIGRATION_FILE,
    });
    ({ data, error } = await runQuery(BASE_ORDER_SELECT, false));
  }

  if (error) {
    log.error("admin_order_list_failed", {
      message: describeDbError(error),
      code: error.code ?? null,
    });
    throw new HttpError(500, ErrorCodes.internal, "Gagal memuat daftar order.");
  }
  return ((data ?? []) as AdminOrderView[]).map(normalizeOrderRow);
}

export async function getAdminOrder(orderId: string): Promise<AdminOrderView | null> {
  const db = await storeDb();
  const { data } = await db.from("orders").select("*").eq("id", orderId).maybeSingle<AdminOrderView>();
  return data ? normalizeOrderRow(data) : null;
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
  return data ? normalizeOrderRow(data) : null;
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

  // Statistik "perlu verifikasi" menyaring kolom pembayaran manual: dilewati
  // (dianggap 0) bila database belum di-migrasi, supaya dashboard tetap tampil.
  const supportsManual = await isManualPaymentSchemaReady();
  const manualQueueQuery = supportsManual
    ? db
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("payment_method", PAYMENT_METHOD_MANUAL)
        .eq("payment_status", "PENDING")
        .not("manual_claim_at", "is", null)
    : null;

  const [a, b, c, d, e, f, g] = await Promise.all([
    db.from("orders").select("id", { count: "exact", head: true }).gte("created_at", dayStart),
    db.from("orders").select("id", { count: "exact", head: true }).eq("order_status", "PAID"),
    db.from("orders").select("id", { count: "exact", head: true }).eq("order_status", "PROCESSING"),
    db.from("orders").select("id", { count: "exact", head: true }).eq("order_status", "PENDING"),
    db.from("orders").select("id", { count: "exact", head: true }).eq("order_status", "DONE").gte("updated_at", dayStart),
    db.from("orders").select("total_amount").in("payment_status", ["PAID"]).gte("paid_at", monthStart),
    manualQueueQuery,
  ]);
  // Query `count` memakai HEAD → body error kosong, jadi `message` bisa "".
  // Sertakan nama statistik + kode error agar log tetap bisa dipakai.
  for (const [stat, r] of [
    ["ordersToday", a],
    ["needProcessing", b],
    ["processing", c],
    ["pendingPayment", d],
    ["doneToday", e],
    ["revenueMonth", f],
    ["needVerification", g],
  ] as const) {
    if (r?.error) {
      log.error("admin_stats_failed", {
        stat,
        message: describeDbError(r.error),
        code: r.error.code ?? null,
      });
    }
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
    needVerification: g?.count ?? 0,
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
