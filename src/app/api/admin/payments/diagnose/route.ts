import { handleApi, ok } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { rateLimit } from "@/lib/ratelimit";
import { HttpError, ErrorCodes } from "@/lib/api";
import { diagnosePaymentProvider } from "@/lib/integrations/payment/diagnose";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/payments/diagnose — diagnosa koneksi YoBasePay (admin only).
 *
 * Memanggil `checkstatus` dengan trxid karangan: TANPA efek samping (tidak
 * membuat transaksi, tidak memotong saldo), tetapi cukup untuk mengetahui
 * apakah API key / domain lock / saldo / paket diterima provider.
 *
 * Respons memuat vonis + langkah perbaikan + pratinjau env yang DISAMARKAN.
 * Tidak ada nilai rahasia yang dikembalikan utuh.
 */
export async function GET() {
  return handleApi(async () => {
    const ctx = await requireAdmin();

    // Provider benar-benar dihubungi → batasi agar tidak dipakai hammering.
    const rl = rateLimit(`paydiag:${ctx.user.id}`, 10, 10 * 60_000);
    if (!rl.ok) {
      throw new HttpError(
        429,
        ErrorCodes.tooManyRequests,
        `Terlalu sering menjalankan diagnosa. Coba lagi dalam ${rl.retryAfterSec} detik.`,
      );
    }

    const diagnostics = await diagnosePaymentProvider();
    return { diagnostics };
  }, (data) => ok(data));
}
