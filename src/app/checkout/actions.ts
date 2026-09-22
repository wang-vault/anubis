"use server";

import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/authz";
import { HttpError } from "@/lib/api";
import { createOrderForBuyer, updateBuyerWhatsapp } from "@/lib/orders";
import { checkoutSchema } from "@/lib/validation";
import { normalizeWhatsapp } from "@/lib/phone";
import { rateLimit } from "@/lib/ratelimit";
import { rethrowNextControlFlow } from "@/lib/action-errors";
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

  // Samakan proteksi dengan POST /api/orders (anti spam order).
  const rl = rateLimit(`order:${ctx.user.id}`, 10, 10 * 60_000);
  if (!rl.ok) {
    return {
      error: `Terlalu banyak percobaan. Coba lagi dalam ${rl.retryAfterSec} detik.`,
    };
  }

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

  let orderCode: string;
  try {
    const { order } = await createOrderForBuyer(ctx, {
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
      whatsappOverride,
    });
    orderCode = order.order_code;
  } catch (err) {
    rethrowNextControlFlow(err);
    if (err instanceof HttpError) {
      // Pesan HttpError sudah didesain aman & jelas untuk user.
      return { error: err.message };
    }
    log.errorFrom("checkout_unexpected", err);
    return { error: "Terjadi kesalahan. Coba lagi beberapa saat." };
  }

  // redirect() di LUAR try/catch — melempar NEXT_REDIRECT, jangan ditelan.
  redirect(`/pay/${orderCode}`);
}
