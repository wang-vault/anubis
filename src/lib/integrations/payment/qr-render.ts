import "server-only";
import QRCode from "qrcode";
import { log } from "@/lib/logger";
import { isQrisPayload } from "./normalize";

/**
 * ===========================================================================
 * RENDERER QR LOKAL — payload QRIS → data URI PNG
 * ===========================================================================
 * Stenly mengembalikan `qr_string` (payload EMVCo standar) dan `qr_image_url`.
 * Kita sengaja TIDAK memakai `qr_image_url` provider karena contoh resmi
 * menunjukkan URL itu membawa SECRET KEY pada query string
 * (`/api/v1/qr/INV-…?api_key=sk_live_…`) — menaruhnya di atribut `src` sebuah
 * <img> berarti mengirim kredensial server ke browser pembeli.
 *
 * Gantinya payload dirender di server memakai package `qrcode` (tanpa jaringan):
 *  - payload pembayaran tidak pernah dikirim ke layanan QR pihak ketiga,
 *  - tidak ada kredensial yang bocor ke bundle/halaman,
 *  - hasilnya data URI PNG yang lolos `isRenderableQrSrc()`.
 *
 * Ukuran hasil ±2–6 KB untuk payload QRIS biasa, jadi aman disimpan di kolom
 * `orders.qr_image_url` dan di-render langsung.
 */

/** Lebar sisi gambar QR (px). 320 = tajam di mobile tanpa memboroskan byte. */
const QR_WIDTH = 320;
/** Batas ukuran data URI yang mau kita simpan ke database (byte). */
const MAX_DATA_URI_BYTES = 200 * 1024;

/**
 * Render payload QRIS menjadi data URI PNG.
 * Return null bila payload tidak valid atau proses render gagal — pemanggil
 * jatuh ke `payment_url` (UI menampilkan tombol "Buka Halaman Pembayaran").
 */
export async function renderQrisToDataUri(payload: string): Promise<string | null> {
  if (!isQrisPayload(payload)) {
    log.warn("stenly_qr_payload_rejected", { length: payload?.length ?? 0 });
    return null;
  }
  try {
    const dataUri = await QRCode.toDataURL(payload, {
      // Level M = standar QRIS; cukup tahan terhadap layar kotor/pantulan.
      errorCorrectionLevel: "M",
      type: "image/png",
      width: QR_WIDTH,
      margin: 1,
      color: { dark: "#000000ff", light: "#ffffffff" },
    });
    if (dataUri.length > MAX_DATA_URI_BYTES) {
      log.warn("stenly_qr_too_large", { bytes: dataUri.length });
      return null;
    }
    return dataUri;
  } catch (err) {
    log.errorFrom("stenly_qr_render_failed", err);
    return null;
  }
}
