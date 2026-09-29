import type { NextRequest } from "next/server";
import { ErrorCodes, handleApi, HttpError, ok } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { fetchFromCobalt, parseUserUrl, resolveCobaltMedia } from "@/lib/cobalt";

export const dynamic = "force-dynamic";

/**
 * GET /api/pinterest?url=<pinterest_url>
 *
 * Fitur PUBLIK (tanpa login): ambil tautan unduh gambar/video sebuah pin
 * Pinterest lewat Cobalt instance #2 (self-hosted di Railway), lalu kembalikan
 * tautan + nama file-nya ke browser.
 *
 * Terpisah total dari fitur toko — endpoint ini TIDAK menyentuh database
 * Supabase maupun order/pembayaran.
 *
 * Throttle: 10 request / 60 detik per IP (limiter in-memory best-effort —
 * lihat catatan di src/lib/ratelimit.ts untuk proteksi serius di edge).
 *
 * Endpoint Cobalt: POST ${COBALT_API_URL_2} (lihat .env.local / env Vercel).
 * Tidak ada proxy /download: browser mengunduh LANGSUNG dari tautan Cobalt,
 * jadi bandwidth Vercel tidak terpakai.
 */

const SERVICE = "pinterest";
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

const INVALID_URL_MESSAGE =
  "URL tidak valid. Tempelkan link pin Pinterest yang lengkap, mis. https://www.pinterest.com/pin/1234567890/ atau https://pin.it/AbCdEfG";

/** Tautan pendek resmi Pinterest (dibagikan dari aplikasi HP). */
function isShortLinkHost(hostname: string): boolean {
  return hostname === "pin.it" || hostname.endsWith(".pin.it");
}

/**
 * Host Pinterest, termasuk subdomain negara (id., www., …) dan domain ccTLD
 * (pinterest.co.uk, pinterest.com.au, …).
 *
 * Caranya: label "pinterest" harus berada tepat sebelum suffix-nya — posisi
 * kedua dari belakang (pinterest.com) atau ketiga (pinterest.co.uk). Dengan
 * begitu "notpinterest.com" dan "pinterest.com.evil.net" ikut tertolak.
 */
function isPinterestHost(hostname: string): boolean {
  const labels = hostname.split(".");
  const index = labels.lastIndexOf("pinterest");
  return index !== -1 && (index === labels.length - 2 || index === labels.length - 3);
}

/** Validasi URL pin + ambil ID-nya (dipakai untuk nama file cadangan). */
function parsePinterestUrl(raw: string): { url: string; id: string } {
  const parsed = parseUserUrl(raw, INVALID_URL_MESSAGE);
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (isShortLinkHost(host)) {
    const code = segments[0] ?? "";
    if (!code) {
      throw new HttpError(
        400,
        ErrorCodes.validation,
        "Tautan pin.it belum lengkap. Salin ulang tautannya dari tombol Bagikan di aplikasi Pinterest.",
      );
    }
    return { url: parsed.toString(), id: code };
  }

  if (!isPinterestHost(host)) {
    throw new HttpError(
      400,
      ErrorCodes.validation,
      "Hanya URL Pinterest yang didukung (pinterest.com/pin/… atau pin.it/…).",
    );
  }

  // Bentuk yang diterima: /pin/<id>/… dan varian AMP /amp/pin/<id>/…
  const offset = segments[0] === "amp" ? 1 : 0;
  const id = segments[offset] === "pin" ? (segments[offset + 1] ?? "") : "";
  if (!id) {
    throw new HttpError(
      400,
      ErrorCodes.validation,
      "Hanya tautan pin yang didukung — mis. https://www.pinterest.com/pin/1234567890/. Tautan papan (board) atau profil tidak bisa diunduh.",
    );
  }

  return { url: parsed.toString(), id };
}

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    // Rate limit dulu — endpoint publik, jangan kerjakan apa pun untuk spammer.
    const rl = rateLimit(`pin:${clientIp(request.headers)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rl.ok) {
      throw new HttpError(
        429,
        ErrorCodes.tooManyRequests,
        `Terlalu banyak permintaan. Batas ${RATE_LIMIT_MAX}x per menit — coba lagi dalam ${rl.retryAfterSec} detik.`,
      );
    }

    const raw = request.nextUrl.searchParams.get("url")?.trim() ?? "";
    if (!raw) {
      throw new HttpError(400, ErrorCodes.validation, "Parameter `url` wajib diisi dengan link pin Pinterest.");
    }

    const { url, id } = parsePinterestUrl(raw);

    const body = await fetchFromCobalt({
      sourceUrl: url,
      downloadMode: "auto",
      service: SERVICE,
      rejectedMessage:
        "Pin tidak dapat diproses. Pastikan tautannya benar, pin-nya masih ada, dan papan/akunnya publik.",
    });

    return resolveCobaltMedia(body, SERVICE, {
      fallbackBaseName: `pinterest-${id}`,
      noMediaMessage:
        "Pin ini tidak punya media yang bisa diunduh — kemungkinan isinya hanya tautan ke situs lain.",
      pickerMessage:
        "Pin ini berisi beberapa media sekaligus. Buka pin aslinya, lalu salin tautan satu media saja.",
    });
  }, (data) => ok(data));
}
