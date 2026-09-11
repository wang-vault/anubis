"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthContext } from "@/lib/authz";
import { HttpError } from "@/lib/api";
import { adminCreateProduct, adminUpdateProduct } from "@/lib/products";
import { adminTransition, findOrderByCodeOrId, refreshOrderStatus } from "@/lib/orders";
import { productInputSchema } from "@/lib/validation";
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
