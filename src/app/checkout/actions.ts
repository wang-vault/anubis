"use server";

import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/authz";
import { HttpError } from "@/lib/api";
import { createOrderForBuyer, updateBuyerWhatsapp } from "@/lib/orders";
import { checkoutSchema } from "@/lib/validation";
import { normalizeWhatsapp } from "@/lib/phone";
import { log } from "@/lib/logger";

export interface ActionState {
  error?: string;
}

/**
 * Submit checkout. Server mengulang SEMUA validasi (session, verifikasi
 * email, produk aktif, harga & total dari DB) — input client hanya dipakai
 * sebagai pilihan produk & jumlah.
 */
export async function checkoutAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/auth/login?next=/checkout");
  if (!ctx.emailVerified) redirect("/auth/verify?unverified=1");
  if (!ctx.profile) redirect("/auth/verify");

  const parsed = checkoutSchema.safeParse({
    productId: formData.get("productId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) {
    return { error: "Pilihan produk/jumlah tidak valid. Muat ulang halaman lalu coba lagi." };
  }

  // Perbaiki nomor WhatsApp bila buyer mengubahnya di form checkout.
  let whatsappOverride: string | undefined;
  const waRaw = formData.get("whatsapp");
  if (typeof waRaw === "string" && waRaw.trim().length > 0) {
    const normalized = normalizeWhatsapp(waRaw);
    if (!normalized) {
      return { error: "Nomor WhatsApp tidak valid. Contoh format: 081234567890." };
    }
    if (normalized !== ctx.profile.whatsapp) {
      await updateBuyerWhatsapp(ctx.user.id, normalized);
    }
    whatsappOverride = normalized;
  }

  try {
    const { order } = await createOrderForBuyer(ctx, {
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
      whatsappOverride,
    });
    redirect(`/pay/${order.order_code}`);
  } catch (err) {
    if (err instanceof HttpError) {
      // Pesan HttpError sudah didesain aman & jelas untuk user.
      return { error: err.message };
    }
    log.errorFrom("checkout_unexpected", err);
    return { error: "Terjadi kesalahan. Coba lagi beberapa saat." };
  }
}
