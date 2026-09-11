import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { getManualQrImage } from "@/lib/payment-config";

export const dynamic = "force-dynamic";

/**
 * GET /api/manual-qr — menyajikan gambar QRIS statis milik penjual.
 *
 * Gambar disimpan base64 di tabel manual_payment_settings (Supabase #2) dan
 * disajikan sebagai image response agar:
 *  - tidak perlu bucket storage / hosting eksternal,
 *  - HTML halaman bayar tidak meng-embed data URI berukuran ratusan KB,
 *  - gambar bisa di-cache browser/CDN (Cache-Control di bawah).
 *
 * Catatan keamanan: QRIS statis memang dirancang untuk dibagikan publik
 * (dipindai siapa pun yang mau membayar), jadi endpoint ini boleh tanpa login.
 * Bila `MANUAL_PAYMENT_QR_IMAGE_URL` diisi, permintaan di-redirect ke URL itu.
 */
export async function GET(_request: NextRequest) {
  const env = serverEnv();
  if (env.MANUAL_PAYMENT_QR_IMAGE_URL) {
    return NextResponse.redirect(env.MANUAL_PAYMENT_QR_IMAGE_URL, 302);
  }

  const image = await getManualQrImage();
  if (!image) {
    return new NextResponse("QR pembayaran manual belum diunggah penjual.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const bytes = Buffer.from(image.base64, "base64");
  if (bytes.byteLength === 0) {
    return new NextResponse("Gambar QR tidak valid.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": image.mime || "image/png",
      "Content-Length": String(bytes.byteLength),
      // Versi di query (?v=updated_at) membuat URL berubah saat QR diganti.
      "Cache-Control": "public, max-age=300, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
