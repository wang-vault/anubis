import type { NextRequest } from "next/server";
import { ErrorCodes, handleApi, HttpError, ok } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/tiktok?url=<tiktok_url>
 *
 * Fitur PUBLIK (tanpa login): ambil info & tautan media sebuah video TikTok
 * lewat API pihak ketiga tikwm.com, lalu kembalikan ringkasannya (judul,
 * sampul, tautan video tanpa/with watermark, audio, durasi, author).
 *
 * Terpisah total dari fitur toko — endpoint ini TIDAK menyentuh database
 * Supabase maupun order/pembayaran.
 *
 * Throttle: 10 request / 60 detik per IP (limiter in-memory best-effort —
 * lihat catatan di src/lib/ratelimit.ts untuk proteksi serius di edge).
 */

const TIKWM_ORIGIN = "https://www.tikwm.com";
const TIKWM_API = `${TIKWM_ORIGIN}/api/`;
const FETCH_TIMEOUT_MS = 15_000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Bentuk respons tikwm (sebagian) — hanya field yang kita pakai. */
interface TikwmAuthor {
  id?: string;
  unique_id?: string;
  nickname?: string;
  avatar?: string;
}

interface TikwmData {
  id?: string;
  title?: string;
  cover?: string;
  duration?: number;
  /** Video tanpa watermark — sering berupa path relatif ("/video/tos/…"). */
  play?: string;
  /** Video dengan watermark — sering berupa path relatif. */
  wmplay?: string;
  music?: string;
  author?: TikwmAuthor;
}

interface TikwmResponse {
  code?: number;
  msg?: string;
  data?: TikwmData;
}

/** Ringkasan yang dikirim ke browser. */
interface TikTokMedia {
  title: string;
  cover: string;
  play: string;
  wmplay: string;
  music: string;
  duration: number;
  author: { nickname: string; avatar: string };
}

/** Nama error (mis. "TimeoutError") tanpa mengasumsikan err instanceof Error. */
function errorName(err: unknown): string {
  if (typeof err === "object" && err !== null && "name" in err) {
    return String((err as { name: unknown }).name);
  }
  return "";
}

/** Host valid: tiktok.com atau subdomain-nya (www., vm., vt., m., …). */
function isTikTokHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "tiktok.com" || host.endsWith(".tiktok.com");
}

/**
 * Validasi & normalisasi URL TikTok dari user.
 * Ramah-user: bila scheme hilang ("vm.tiktok.com/…") dicoba ulang dengan
 * prefix https:// — host tetap divalidasi ketat setelahnya.
 */
function parseTikTokUrl(raw: string): string {
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
      "URL tidak valid. Tempelkan link video TikTok yang lengkap, mis. https://www.tiktok.com/@user/video/…",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, ErrorCodes.validation, "URL harus diawali http:// atau https://.");
  }
  if (parsed.username || parsed.password) {
    throw new HttpError(400, ErrorCodes.validation, "URL tidak boleh mengandung kredensial (user:pass@host).");
  }
  if (!isTikTokHost(parsed.hostname)) {
    throw new HttpError(
      400,
      ErrorCodes.validation,
      "Hanya URL TikTok yang didukung (tiktok.com, vm.tiktok.com, vt.tiktok.com).",
    );
  }
  return parsed.toString();
}

/**
 * tikwm kadang mengembalikan path relatif (mis. "/video/tos/…") untuk file
 * video — lengkapi dengan origin tikwm agar bisa dibuka browser langsung.
 * URL kosong/unknown → null (dipakai sebagai penanda "tidak tersedia").
 */
function toAbsoluteMediaUrl(url: string | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${TIKWM_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Panggil tikwm dan kembalikan field `data`-nya. Error provider → HttpError + log. */
async function fetchFromTikwm(videoUrl: string): Promise<TikwmData> {
  const api = `${TIKWM_API}?url=${encodeURIComponent(videoUrl)}&hd=1`;

  let res: Response;
  try {
    res = await fetch(api, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; AnubisStore/1.0)",
      },
    });
  } catch (err) {
    if (errorName(err) === "TimeoutError" || errorName(err) === "AbortError") {
      throw new HttpError(
        504,
        ErrorCodes.internal,
        "Waktu tunggu habis (15 detik). Server TikTok tidak merespons — silakan coba lagi.",
      );
    }
    // Detail (DNS, koneksi, dsb.) hanya ke log; user lihat pesan generik.
    log.errorFrom("tiktok_upstream_fetch_error", err, { host: TIKWM_ORIGIN });
    throw new HttpError(502, ErrorCodes.internal, "Gagal menghubungi server TikTok. Silakan coba lagi beberapa saat.");
  }

  if (!res.ok) {
    log.warn("tiktok_upstream_http_error", { status: res.status });
    throw new HttpError(
      502,
      ErrorCodes.internal,
      `Server TikTok menolak permintaan (HTTP ${res.status}). Silakan coba lagi beberapa saat.`,
    );
  }

  let body: TikwmResponse;
  try {
    body = (await res.json()) as TikwmResponse;
  } catch (err) {
    log.errorFrom("tiktok_upstream_invalid_json", err);
    throw new HttpError(502, ErrorCodes.internal, "Respons server TikTok tidak dapat dibaca. Silakan coba lagi.");
  }

  if (typeof body.code !== "number" || body.code !== 0 || !body.data) {
    // Pesan asli tikwm bisa jadi teknis/bervariasi → simpan di log saja.
    log.warn("tiktok_upstream_api_error", { code: body.code, msg: body.msg });
    if (typeof body.msg === "string" && /limit/i.test(body.msg)) {
      throw new HttpError(
        503,
        ErrorCodes.internal,
        "Server sedang sibuk (antrean penuh). Tunggu sebentar lalu coba lagi.",
      );
    }
    throw new HttpError(
      400,
      ErrorCodes.validation,
      "Video tidak dapat diproses. Pastikan link video TikTok benar, video masih tersedia, dan bukan video private.",
    );
  }

  return body.data;
}

/** Susun respons final; wajib ada tautan video tanpa watermark (`play`). */
function toMedia(data: TikwmData): TikTokMedia {
  const play = toAbsoluteMediaUrl(data.play);
  if (!play) {
    throw new HttpError(
      422,
      ErrorCodes.validation,
      "Video ini tidak memiliki media yang bisa diunduh (mungkin postingan foto atau video private).",
    );
  }

  const duration = typeof data.duration === "number" && Number.isFinite(data.duration) ? data.duration : 0;

  return {
    title: data.title ?? "",
    cover: toAbsoluteMediaUrl(data.cover) ?? "",
    play,
    wmplay: toAbsoluteMediaUrl(data.wmplay) ?? "",
    music: toAbsoluteMediaUrl(data.music) ?? "",
    duration,
    author: {
      nickname: data.author?.nickname ?? "",
      avatar: toAbsoluteMediaUrl(data.author?.avatar) ?? "",
    },
  };
}

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    // Rate limit dulu — endpoint publik, jangan kerjakan apapun untuk spammer.
    const rl = rateLimit(`tt:${clientIp(request.headers)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rl.ok) {
      throw new HttpError(
        429,
        ErrorCodes.tooManyRequests,
        `Terlalu banyak permintaan. Batas ${RATE_LIMIT_MAX}x per menit — coba lagi dalam ${rl.retryAfterSec} detik.`,
      );
    }

    const raw = request.nextUrl.searchParams.get("url")?.trim() ?? "";
    if (!raw) {
      throw new HttpError(400, ErrorCodes.validation, "Parameter `url` wajib diisi dengan link video TikTok.");
    }

    const videoUrl = parseTikTokUrl(raw);
    const data = await fetchFromTikwm(videoUrl);
    return toMedia(data);
  }, (data) => ok(data));
}
