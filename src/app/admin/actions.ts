"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/lib/authz";
import { HttpError } from "@/lib/api";
import { adminCreateProduct, adminUpdateProduct } from "@/lib/products";
import {
  adminConfirmManualPayment,
  adminRejectManualClaim,
  adminTransition,
  findOrderByCodeOrId,
  refreshOrderStatus,
} from "@/lib/orders";
import {
  MANUAL_QR_ALLOWED_MIME,
  MANUAL_QR_MAX_BYTES,
  saveManualPaymentSettings,
} from "@/lib/payment-config";
import { manualSettingsSchema, productInputSchema } from "@/lib/validation";
import { rethrowNextControlFlow } from "@/lib/action-errors";
import { log } from "@/lib/logger";
import { uuidSchema } from "@/lib/zod-helpers";

export interface AdminActionState {
  error?: string;
}

/** Semua aksi admin: guard role SERVER-SIDE (bukan sekadar hidden field). */
async function requireAdminGuard() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/admin/login");
  if (ctx.profile?.role !== "admin") redirect("/auth/login?error=not_admin");
  return ctx;
}

function sanitizeBack(raw: FormDataEntryValue | null): string {
  const back = typeof raw === "string" ? raw : "";
  if (back.startsWith("/admin") && !back.startsWith("//")) return back;
  return "/admin";
}

// ---------------------------------------------------------------------------
// PRODUCTS
// ---------------------------------------------------------------------------

export async function createProductAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  await requireAdminGuard();
  const parsed = productInputSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    price: formData.get("price"),
    image_url: formData.get("image_url") ?? "",
    is_active: formData.get("is_active") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data produk tidak valid." };
  }
  try {
    await adminCreateProduct({
      name: parsed.data.name,
      description: parsed.data.description,
      price: parsed.data.price,
      image_url: parsed.data.image_url || null,
      is_active: parsed.data.is_active,
    });
  } catch (err) {
    rethrowNextControlFlow(err);
    if (err instanceof HttpError) return { error: err.message };
    log.errorFrom("create_product_unexpected", err);
    return { error: "Gagal menyimpan produk." };
  }
  redirect("/admin/products?created=1");
}

export async function updateProductAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const ctx = await requireAdminGuard();
  const id = String(formData.get("id") ?? "");
  if (!uuidSchema.safeParse(id).success) return { error: "ID produk tidak valid." };
  const parsed = productInputSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    price: formData.get("price"),
    image_url: formData.get("image_url") ?? "",
    is_active: formData.get("is_active") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data produk tidak valid." };
  }
  try {
    await adminUpdateProduct(id, {
      name: parsed.data.name,
      description: parsed.data.description,
      price: parsed.data.price,
      image_url: parsed.data.image_url || null,
      is_active: parsed.data.is_active,
    });
  } catch (err) {
    rethrowNextControlFlow(err);
    if (err instanceof HttpError) return { error: err.message };
    log.errorFrom("update_product_unexpected", err, { admin: ctx.user.id });
    return { error: "Gagal menyimpan produk." };
  }
  redirect("/admin/products?saved=1");
}

const toggleSchema = z.object({
  id: uuidSchema,
  active: z.enum(["true", "false"]),
  back: z.string().optional(),
});

export async function toggleProductAction(formData: FormData): Promise<void> {
  await requireAdminGuard();
  const parsed = toggleSchema.safeParse({
    id: formData.get("id"),
    active: formData.get("active"),
    back: formData.get("back") ?? undefined,
  });
  if (!parsed.success) return;
  try {
    await adminUpdateProduct(parsed.data.id, { is_active: parsed.data.active === "true" });
  } catch (err) {
    log.errorFrom("toggle_product_failed", err);
  }
  redirect(sanitizeBack(formData.get("back")));
}

// ---------------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------------

const orderFormSchema = z.object({
  orderId: uuidSchema,
  action: z.enum(["process", "complete", "expire"]),
});

/** Tombol dashboard: Proses / Tandai Selesai / Expire (batal order mati). */
export async function orderTransitionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminGuard();
  const parsed = orderFormSchema.safeParse({
    orderId: formData.get("orderId"),
    action: formData.get("action"),
  });
  if (!parsed.success) redirect("/admin/orders?error=invalid");

  try {
    await adminTransition(parsed.data.orderId, parsed.data.action, ctx);
  } catch (err) {
    rethrowNextControlFlow(err);
    if (err instanceof HttpError) {
      redirect(
        `/admin/orders?error=${encodeURIComponent(err.message)}&t=${Date.now()}`,
      );
    }
    log.errorFrom("admin_transition_unexpected", err);
    redirect("/admin/orders?error=internal&t=1");
  }
  redirect(sanitizeBack(formData.get("back")));
}

/** Tombol "Cek status ke YoBasePay" — sinkron manual, sumber = provider. */
export async function refreshOrderPaymentAction(formData: FormData): Promise<void> {
  await requireAdminGuard();
  const orderId = String(formData.get("orderId") ?? "");
  const back = sanitizeBack(formData.get("back"));
  if (!uuidSchema.safeParse(orderId).success) redirect(back);
  const order = await findOrderByCodeOrId(orderId);
  if (order && order.payment_status === "PENDING") {
    try {
      await refreshOrderStatus(order);
    } catch (err) {
      log.errorFrom("admin_refresh_payment_failed", err);
    }
  }
  redirect(back);
}

// ---------------------------------------------------------------------------
// PEMBAYARAN MANUAL — verifikasi penjual & pengaturan QR statis
// ---------------------------------------------------------------------------

const manualReviewFormSchema = z.object({
  orderId: uuidSchema,
  /** Nominal yang benar-benar masuk (opsional). Kosong = pakai nominal order. */
  receivedAmount: z.coerce
    .number()
    .int()
    .min(1)
    .max(100_000_000)
    .optional()
    .or(z.literal("")),
  note: z.string().trim().max(300).optional().default(""),
});

function parseManualReviewForm(formData: FormData) {
  const rawAmount = formData.get("receivedAmount");
  return manualReviewFormSchema.safeParse({
    orderId: formData.get("orderId"),
    receivedAmount:
      typeof rawAmount === "string" && rawAmount.trim() === "" ? undefined : rawAmount,
    note: formData.get("note") ?? "",
  });
}

/**
 * "Konfirmasi Pembayaran" — penjual menyatakan uang SUDAH masuk setelah
 * mencocokkan mutasi QRIS/rekening. Ini satu-satunya jalan order manual jadi PAID.
 */
export async function confirmManualPaymentAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminGuard();
  const back = sanitizeBack(formData.get("back"));
  const parsed = parseManualReviewForm(formData);
  if (!parsed.success) redirect(`${back}${back.includes("?") ? "&" : "?"}error=invalid`);

  try {
    await adminConfirmManualPayment(parsed.data.orderId, ctx, {
      receivedAmount:
        typeof parsed.data.receivedAmount === "number" ? parsed.data.receivedAmount : null,
      note: parsed.data.note,
    });
  } catch (err) {
    rethrowNextControlFlow(err);
    if (err instanceof HttpError) {
      redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(err.message)}`);
    }
    log.errorFrom("confirm_manual_payment_unexpected", err);
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=internal`);
  }
  redirect(back);
}

/** "Tolak klaim" — mutasi tidak ditemukan. Buyer boleh konfirmasi ulang. */
export async function rejectManualClaimAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminGuard();
  const back = sanitizeBack(formData.get("back"));
  const parsed = manualReviewFormSchema
    .pick({ orderId: true, note: true })
    .safeParse({ orderId: formData.get("orderId"), note: formData.get("note") ?? "" });
  if (!parsed.success) redirect(`${back}${back.includes("?") ? "&" : "?"}error=invalid`);

  try {
    await adminRejectManualClaim(parsed.data.orderId, ctx, { note: parsed.data.note });
  } catch (err) {
    rethrowNextControlFlow(err);
    if (err instanceof HttpError) {
      redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(err.message)}`);
    }
    log.errorFrom("reject_manual_claim_unexpected", err);
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=internal`);
  }
  redirect(back);
}

/**
 * Simpan pengaturan pembayaran manual (label, a.n., instruksi, batas waktu,
 * gambar QR). Gambar di-upload sebagai File → base64 (maks ~900 KB).
 */
export async function saveManualPaymentSettingsAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const ctx = await requireAdminGuard();

  const parsed = manualSettingsSchema.safeParse({
    is_enabled: formData.get("is_enabled") === "on",
    label: formData.get("label"),
    account_name: formData.get("account_name") ?? "",
    instructions: formData.get("instructions") ?? "",
    expiry_minutes: formData.get("expiry_minutes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Pengaturan tidak valid." };
  }

  // --- gambar QR (opsional) ---
  let qrImage: { mime: string; base64: string; size: number } | null | "clear" = null;
  if (formData.get("clear_qr") === "1") {
    qrImage = "clear";
  } else {
    const file = formData.get("qr_image");
    if (file instanceof File && file.size > 0) {
      if (!MANUAL_QR_ALLOWED_MIME.includes(file.type as (typeof MANUAL_QR_ALLOWED_MIME)[number])) {
        return {
          error: `Format gambar tidak didukung (${file.type || "tanpa tipe"}). Gunakan PNG, JPG, atau WebP.`,
        };
      }
      if (file.size > MANUAL_QR_MAX_BYTES) {
        return {
          error: `Gambar terlalu besar (${Math.round(file.size / 1024)} KB). Maksimal ${Math.round(
            MANUAL_QR_MAX_BYTES / 1024,
          )} KB — perkecil dulu (mis. screenshot lalu crop).`,
        };
      }
      try {
        const buf = Buffer.from(await file.arrayBuffer());
        qrImage = {
          mime: file.type || "image/png",
          base64: buf.toString("base64"),
          size: buf.byteLength,
        };
      } catch (err) {
        log.errorFrom("manual_qr_read_failed", err);
        return { error: "Gagal membaca file gambar. Coba lagi." };
      }
    }
  }

  try {
    await saveManualPaymentSettings({
      is_enabled: parsed.data.is_enabled,
      label: parsed.data.label,
      account_name: parsed.data.account_name,
      instructions: parsed.data.instructions,
      expiry_minutes: parsed.data.expiry_minutes,
      qr_image: qrImage,
    });
  } catch (err) {
    rethrowNextControlFlow(err);
    if (err instanceof HttpError) return { error: err.message };
    log.errorFrom("save_manual_settings_unexpected", err, { admin: ctx.user.id });
    return { error: "Gagal menyimpan pengaturan." };
  }
  redirect("/admin/settings?saved=1");
}
