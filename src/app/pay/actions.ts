"use server";

import { getAuthContext } from "@/lib/authz";
import { HttpError } from "@/lib/api";
import { claimManualPayment, getOrderByCodeForBuyer } from "@/lib/orders";
import { manualClaimSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/ratelimit";
import { rethrowNextControlFlow } from "@/lib/action-errors";
import { log } from "@/lib/logger";

export interface ManualClaimState {
  ok?: boolean;
  error?: string;
  claimedAt?: string;
}

/**
 * Buyer menekan "Saya sudah transfer" untuk order pembayaran MANUAL.
 *
 * Yang dilakukan server:
 *  - session + kepemilikan order (account_id) diverifikasi ulang,
 *  - klaim dicatat (manual_claim_at + catatan + no. referensi),
 *  - penjual dinotifikasi Telegram (sekali per klaim).
 *
 * Yang TIDAK dilakukan: klaim ini TIDAK membuat order menjadi PAID. Status
 * lunas hanya bisa di-set penjual dari dashboard setelah mencocokkan mutasi.
 */
export async function claimManualPaymentAction(
  _prev: ManualClaimState,
  formData: FormData,
): Promise<ManualClaimState> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Sesi kamu berakhir. Silakan login lalu coba lagi." };

  const parsed = manualClaimSchema.safeParse({
    orderCode: String(formData.get("orderCode") ?? "").toUpperCase(),
    note: formData.get("note") ?? "",
    reference: formData.get("reference") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data konfirmasi tidak valid." };
  }

  // Anti spam klaim (best-effort per instance; proteksi utama tetap di server).
  const rl = rateLimit(`claim:${ctx.user.id}`, 10, 10 * 60_000);
  if (!rl.ok) {
    return { error: `Terlalu sering mencoba. Coba lagi dalam ${rl.retryAfterSec} detik.` };
  }

  const order = await getOrderByCodeForBuyer(parsed.data.orderCode, ctx.user.id);
  if (!order) return { error: "Order tidak ditemukan." };

  try {
    const res = await claimManualPayment(order, {
      note: parsed.data.note,
      reference: parsed.data.reference,
    });
    return { ok: true, claimedAt: res.order.manual_claim_at ?? undefined };
  } catch (err) {
    rethrowNextControlFlow(err);
    if (err instanceof HttpError) return { error: err.message };
    log.errorFrom("manual_claim_unexpected", err);
    return { error: "Terjadi kesalahan. Coba lagi beberapa saat." };
  }
}
