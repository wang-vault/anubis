import type { NextRequest } from "next/server";
import { ErrorCodes, handleApi, HttpError, ok } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { fetchFromCobalt, parseUserUrl, resolveCobaltMedia } from "@/lib/cobalt";

export const dynamic = "force-dynamic";

/**
 * GET /api/soundcloud?url=<soundcloud_url>
 *
 * Fitur PUBLIK (tanpa login): ambil tautan unduh AUDIO sebuah lagu SoundCloud
 * lewat Cobalt instance #2 (self-hosted di Railway), lalu kembalikan tautan +
 * nama file-nya ke browser.
 *
 * Terpisah total dari fitur toko — endpoint ini TIDAK menyentuh database
 * Supabase maupun order/pembayaran.
 *
 * Throttle: 10 request / 60 detik per IP (limiter in-memory best-effort —
 * lihat catatan di src/lib/ratelimit.ts untuk proteksi serius di edge).
 *
 * Endpoint Cobalt: POST ${COBALT_API_URL_2} dengan `downloadMode: "audio"`.
 * Tidak ada proxy /download: browser mengunduh LANGSUNG dari tautan Cobalt,
 * jadi bandwidth Vercel tidak terpakai.
 */

const SERVICE = "soundcloud";
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

const INVALID_URL_MESSAGE =
  "URL tidak valid. Tempelkan link lagu SoundCloud yang lengkap, mis. https://soundcloud.com/artis/judul-lagu";

const TRACK_HINT = "Buka halaman lagunya, lalu salin tautannya — mis. https://soundcloud.com/artis/judul-lagu.";

/**
 * Segmen pertama yang PASTI bukan nama artis — halaman internal SoundCloud.
 * Ditolak lebih awal supaya user dapat pesan jelas, bukan error dari Cobalt.
 */
const RESERVED_SEGMENTS = new Set([
  "discover",
  "stream",
  "upload",
  "you",
  "search",
  "settings",
  "pages",
  "tags",
  "charts",
  "people",
  "feed",
  "library",
  "notifications",
  "messages",
  "terms-of-use",
  "imprint",
  "jobs",
  "mobile",
]);

/** Host valid: soundcloud.com atau subdomainnya (www., m., on., …). */
function isSoundCloudHost(hostname: string): boolean {
  return hostname === "soundcloud.com" || hostname.endsWith(".soundcloud.com");
}

/** Validasi URL lagu + ambil slug-nya (dipakai untuk nama file cadangan). */
function parseSoundCloudUrl(raw: string): { url: string; id: string } {
  const parsed = parseUserUrl(raw, INVALID_URL_MESSAGE);
  const host = parsed.hostname.toLowerCase();

  if (!isSoundCloudHost(host)) {
    throw new HttpError(
      400,
      ErrorCodes.validation,
      "Hanya URL SoundCloud yang didukung (soundcloud.com/artis/judul-lagu).",
    );
  }

  const segments = parsed.pathname.split("/").filter(Boolean);

  // Tautan pendek dari tombol Bagikan: on.soundcloud.com/<kode>.
  // Isinya belum bisa dibaca dari URL — biar Cobalt yang mengikuti redirect.
  if (host === "on.soundcloud.com") {
    const code = segments[0] ?? "";
    if (!code) {
      throw new HttpError(
        400,
        ErrorCodes.validation,
        `Tautan on.soundcloud.com belum lengkap. ${TRACK_HINT}`,
      );
    }
    return { url: parsed.toString(), id: code };
  }

  const user = segments[0] ?? "";
  const track = segments[1] ?? "";

  if (!user || RESERVED_SEGMENTS.has(user.toLowerCase())) {
    throw new HttpError(400, ErrorCodes.validation, `Hanya tautan lagu yang didukung. ${TRACK_HINT}`);
  }
  if (!track) {
    throw new HttpError(
      400,
      ErrorCodes.validation,
      `Tautan itu mengarah ke profil artis, bukan satu lagu. ${TRACK_HINT}`,
    );
  }
  if (track.toLowerCase() === "sets") {
    throw new HttpError(
      400,
      ErrorCodes.validation,
      "Tautan playlist/album belum didukung — unduh satu per satu. Buka salah satu lagunya, lalu salin tautan lagu itu.",
    );
  }

  return { url: parsed.toString(), id: `${user}-${track}` };
}

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    // Rate limit dulu — endpoint publik, jangan kerjakan apa pun untuk spammer.
    const rl = rateLimit(`sc:${clientIp(request.headers)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rl.ok) {
      throw new HttpError(
        429,
        ErrorCodes.tooManyRequests,
        `Terlalu banyak permintaan. Batas ${RATE_LIMIT_MAX}x per menit — coba lagi dalam ${rl.retryAfterSec} detik.`,
      );
    }

    const raw = request.nextUrl.searchParams.get("url")?.trim() ?? "";
    if (!raw) {
      throw new HttpError(400, ErrorCodes.validation, "Parameter `url` wajib diisi dengan link lagu SoundCloud.");
    }

    const { url, id } = parseSoundCloudUrl(raw);

    const body = await fetchFromCobalt({
      sourceUrl: url,
      downloadMode: "audio",
      service: SERVICE,
      rejectedMessage:
        "Lagu tidak dapat diproses. Pastikan tautannya benar, lagunya masih ada, dan bukan lagu privat/khusus pengikut.",
    });

    return resolveCobaltMedia(body, SERVICE, {
      fallbackBaseName: `soundcloud-${id}`,
      fallbackExt: "mp3",
      noMediaMessage:
        "Lagu ini tidak bisa diunduh — pengunggahnya kemungkinan mematikan opsi unduh, atau lagunya khusus pengikut.",
      pickerMessage: "Tautan ini berisi beberapa lagu. Buka satu lagunya, lalu salin tautan lagu itu.",
    });
  }, (data) => ok(data));
}
