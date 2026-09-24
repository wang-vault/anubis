import type { NextRequest } from "next/server";
import { ErrorCodes, handleApi, HttpError, ok } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/youtube?url=<youtube_url>
 *
 * Fitur PUBLIK (tanpa login): ambil tautan unduh video/short YouTube lewat
 * Cobalt instance self-hosted (di Railway), lalu kembalikan tautan video +
 * nama file-nya ke browser. Codec H.264 diminta eksplisit agar hasil bisa
 * diputar di (hampir) semua perangkat.
 *
 * Terpisah total dari fitur toko — endpoint ini TIDAK menyentuh database
 * Supabase maupun order/pembayaran.
 *
 * Throttle: 10 request / 60 detik per IP (limiter in-memory best-effort —
 * lihat catatan di src/lib/ratelimit.ts untuk proteksi serius di edge).
 *
 * Endpoint Cobalt: POST ${COBALT_API_URL} (lihat .env.local / env Vercel).
 */

const FETCH_TIMEOUT_MS = 20_000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Bentuk respons Cobalt untuk POST / (sebagian) — hanya field yang kita pakai. */
interface CobaltErrorInfo {
  code?: string;
  message?: string;
}

interface CobaltResponse {
  /** "tunnel" | "redirect" | "local-processing" | "picker" | "error". */
  status?: string;
  /** Tautan file (tunnel Cobalt atau CDN layanan asal) untuk tunnel/redirect. */
  url?: string;
  /** Nama file yang dihasilkan Cobalt (opsional). */
  filename?: string;
  error?: CobaltErrorInfo;
}

/** Hasil akhir yang dikirim ke browser. */
interface YouTubeMedia {
  url: string;
  filename: string;
}

/** Nama error (mis. "TimeoutError") tanpa mengasumsikan err instanceof Error. */
function errorName(err: unknown): string {
  if (typeof err === "object" && err !== null && "name" in err) {
    return String((err as { name: unknown }).name);
  }
  return "";
}

/**
 * Endpoint Cobalt dari environment (wajib, https saja).
 * Tidak diset/salah format → 503 dengan pesan aman untuk user.
 */
function cobaltApiUrl(): string {
  const raw = process.env.COBALT_API_URL?.trim() ?? "";
  if (!raw) {
    throw new HttpError(
      503,
      ErrorCodes.internal,
      "Layanan downloader sedang tidak tersedia. Silakan coba lagi nanti.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    log.error("youtube_cobalt_env_invalid", { reason: "bad_url" });
    throw new HttpError(
      503,
      ErrorCodes.internal,
      "Layanan downloader sedang tidak tersedia. Silakan coba lagi nanti.",
    );
  }
  if (parsed.protocol !== "https:") {
    log.error("youtube_cobalt_env_invalid", { reason: "not_https" });
    throw new HttpError(
      503,
      ErrorCodes.internal,
      "Layanan downloader sedang tidak tersedia. Silakan coba lagi nanti.",
    );
  }
  return raw.replace(/\/+$/, "");
}

/** Host valid: youtube.com / subdomain-nya (www., m., …) atau youtu.be. */
function isYouTubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "youtube.com" || host.endsWith(".youtube.com")) return true;
  if (host === "youtu.be" || host.endsWith(".youtu.be")) return true;
  return false;
}

/**
 * Validasi & normalisasi URL YouTube dari user. Mendukung:
 *  - https://www.youtube.com/watch?v=<id>
 *  - https://youtu.be/<id>
 *  - https://www.youtube.com/shorts/<id>
 * Ramah-user: bila scheme hilang dicoba ulang dengan prefix https:// —
 * host & path tetap divalidasi ketat setelahnya.
 */
function parseYouTubeUrl(raw: string): string {
  const attempts = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? [raw] : [raw, `https://${raw}`];

  let parsed: URL | null = null;
  for (const attempt of attempts) {
    try {
      parsed = new URL(attempt);
      break;
    } catch {
      // coba kandidat berikutnya
    }
  }

  if (!parsed) {
    throw new HttpError(
      400,
      ErrorCodes.validation,
      "URL tidak valid. Tempelkan link video YouTube yang lengkap, mis. https://youtu.be/…",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, ErrorCodes.validation, "URL harus diawali http:// atau https://.");
  }
  if (parsed.username || parsed.password) {
    throw new HttpError(400, ErrorCodes.validation, "URL tidak boleh mengandung kredensial (user:pass@host).");
  }
  if (!isYouTubeHost(parsed.hostname)) {
    throw new HttpError(
      400,
      ErrorCodes.validation,
      "Hanya URL YouTube yang didukung (youtube.com/watch?v=…, youtu.be/…, atau youtube.com/shorts/…).",
    );
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, "");

  // youtu.be/<id>
  if (host === "youtu.be" || host.endsWith(".youtu.be")) {
    const id = parsed.pathname.replace(/^\/+/, "").split("/")[0];
    if (!id) {
      throw new HttpError(
        400,
        ErrorCodes.validation,
        "URL YouTube tidak lengkap — tambahkan ID videonya, mis. https://youtu.be/dQw4w9WgXcQ",
      );
    }
    return parsed.toString();
  }

  // youtube.com/watch?v=<id>
  if (parsed.pathname === "/watch") {
    if (!parsed.searchParams.get("v")) {
      throw new HttpError(
        400,
        ErrorCodes.validation,
        "URL YouTube tidak lengkap — link /watch butuh parameter ?v=<ID video>.",
      );
    }
    return parsed.toString();
  }

  // youtube.com/shorts/<id>
  if (path.startsWith("/shorts/")) {
    const id = path.slice("/shorts/".length).split("/")[0];
    if (!id) {
      throw new HttpError(
        400,
        ErrorCodes.validation,
        "URL YouTube tidak lengkap — tambahkan ID short-nya, mis. https://www.youtube.com/shorts/…",
      );
    }
    return parsed.toString();
  }

  throw new HttpError(
    400,
    ErrorCodes.validation,
    "Hanya link video YouTube yang didukung — youtube.com/watch?v=…, youtu.be/…, atau youtube.com/shorts/…",
  );
}

/** Panggil Cobalt dan kembalikan body-nya. Error provider → HttpError + log. */
async function fetchFromCobalt(videoUrl: string): Promise<CobaltResponse> {
  const apiUrl = cobaltApiUrl();

  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(process.env.COBALT_API_KEY
          ? { Authorization: `Api-Key ${process.env.COBALT_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        url: videoUrl,
        downloadMode: "auto",
        youtubeVideoCodec: "h264",
      }),
    });
  } catch (err) {
    if (errorName(err) === "TimeoutError" || errorName(err) === "AbortError") {
      throw new HttpError(
        504,
        ErrorCodes.internal,
        "Waktu tunggu habis (20 detik). Server downloader tidak merespons — silakan coba lagi.",
      );
    }
    // Detail (DNS, koneksi, dsb.) hanya ke log; user lihat pesan generik.
    log.errorFrom("youtube_upstream_fetch_error", err, { host: apiUrl });
    throw new HttpError(
      502,
      ErrorCodes.internal,
      "Gagal menghubungi server downloader. Silakan coba lagi beberapa saat.",
    );
  }

  let body: CobaltResponse;
  try {
    body = (await res.json()) as CobaltResponse;
  } catch (err) {
    log.errorFrom("youtube_upstream_invalid_json", err, { status: res.status });
    throw new HttpError(
      502,
      ErrorCodes.internal,
      "Respons server downloader tidak dapat dibaca. Silakan coba lagi.",
    );
  }

  if (!res.ok || body.status === "error") {
    // Pesan asli Cobalt bisa jadi teknis/bervariasi → simpan di log saja.
    log.warn("youtube_upstream_api_error", {
      status: res.status,
      code: body.error?.code,
    });
    if (res.status === 429 || /rate|limit/i.test(String(body.error?.code ?? ""))) {
      throw new HttpError(
        503,
        ErrorCodes.internal,
        "Server downloader sedang sibuk (antrean penuh). Tunggu sebentar lalu coba lagi.",
      );
    }
    throw new HttpError(
      400,
      ErrorCodes.validation,
      "Video tidak dapat diproses. Pastikan link YouTube benar, video masih tersedia, dan bukan video private.",
    );
  }

  return body;
}

/** Susun respons final; wajib ada tautan video (status tunnel/redirect). */
function toMedia(body: CobaltResponse): YouTubeMedia {
  if (body.status !== "tunnel" && body.status !== "redirect") {
    throw new HttpError(
      422,
      ErrorCodes.validation,
      "Video ini tidak memiliki media yang bisa diunduh (mungkin live stream atau playlist).",
    );
  }
  if (typeof body.url !== "string" || !body.url) {
    throw new HttpError(
      422,
      ErrorCodes.validation,
      "Tautan unduh tidak tersedia untuk video ini. Silakan coba lagi.",
    );
  }
  return {
    url: body.url,
    filename: typeof body.filename === "string" && body.filename ? body.filename : "video.mp4",
  };
}

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    // Rate limit dulu — endpoint publik, jangan kerjakan apapun untuk spammer.
    const rl = rateLimit(`yt:${clientIp(request.headers)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rl.ok) {
      throw new HttpError(
        429,
        ErrorCodes.tooManyRequests,
        `Terlalu banyak permintaan. Batas ${RATE_LIMIT_MAX}x per menit — coba lagi dalam ${rl.retryAfterSec} detik.`,
      );
    }

    const raw = request.nextUrl.searchParams.get("url")?.trim() ?? "";
    if (!raw) {
      throw new HttpError(400, ErrorCodes.validation, "Parameter `url` wajib diisi dengan link video YouTube.");
    }

    const videoUrl = parseYouTubeUrl(raw);
    const body = await fetchFromCobalt(videoUrl);
    return toMedia(body);
  }, (data) => ok(data));
}
