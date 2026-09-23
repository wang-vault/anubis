import type { NextRequest } from "next/server";
import { ErrorCodes, handleApi, HttpError, ok } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/instagram?url=<instagram_url>
 *
 * Fitur PUBLIK (tanpa login): ambil tautan unduh video sebuah reel/post
 * Instagram lewat Cobalt instance self-hosted (di Railway), lalu kembalikan
 * tautan video-nya ke browser.
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
interface InstagramMedia {
  url: string;
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
    log.error("instagram_cobalt_env_invalid", { reason: "bad_url" });
    throw new HttpError(
      503,
      ErrorCodes.internal,
      "Layanan downloader sedang tidak tersedia. Silakan coba lagi nanti.",
    );
  }
  if (parsed.protocol !== "https:") {
    log.error("instagram_cobalt_env_invalid", { reason: "not_https" });
    throw new HttpError(
      503,
      ErrorCodes.internal,
      "Layanan downloader sedang tidak tersedia. Silakan coba lagi nanti.",
    );
  }
  return raw.replace(/\/+$/, "");
}

/** Host valid: instagram.com atau subdomain-nya (www., m., …). */
function isInstagramHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "instagram.com" || host.endsWith(".instagram.com");
}

/**
 * Validasi & normalisasi URL Instagram dari user.
 * Ramah-user: bila scheme hilang ("www.instagram.com/reel/…") dicoba ulang
 * dengan prefix https:// — host & path tetap divalidasi ketat setelahnya.
 */
function parseInstagramUrl(raw: string): string {
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
      "URL tidak valid. Tempelkan link video Instagram yang lengkap, mis. https://www.instagram.com/reel/…",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, ErrorCodes.validation, "URL harus diawali http:// atau https://.");
  }
  if (parsed.username || parsed.password) {
    throw new HttpError(400, ErrorCodes.validation, "URL tidak boleh mengandung kredensial (user:pass@host).");
  }
  if (!isInstagramHost(parsed.hostname)) {
    throw new HttpError(
      400,
      ErrorCodes.validation,
      "Hanya URL Instagram yang didukung (instagram.com/reel/… atau instagram.com/p/…).",
    );
  }

  // Hanya bentuk reel & post yang didukung.
  const path = parsed.pathname.replace(/\/+$/, "");
  if (!path.startsWith("/reel/") && !path.startsWith("/p/")) {
    throw new HttpError(
      400,
      ErrorCodes.validation,
      "Hanya link reel atau post Instagram yang didukung — mis. https://www.instagram.com/reel/… atau https://www.instagram.com/p/…",
    );
  }

  return parsed.toString();
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
      },
      body: JSON.stringify({ url: videoUrl, downloadMode: "auto" }),
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
    log.errorFrom("instagram_upstream_fetch_error", err, { host: apiUrl });
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
    log.errorFrom("instagram_upstream_invalid_json", err, { status: res.status });
    throw new HttpError(
      502,
      ErrorCodes.internal,
      "Respons server downloader tidak dapat dibaca. Silakan coba lagi.",
    );
  }

  if (!res.ok || body.status === "error") {
    // Pesan asli Cobalt bisa jadi teknis/bervariasi → simpan di log saja.
    log.warn("instagram_upstream_api_error", {
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
      "Video tidak dapat diproses. Pastikan link Instagram benar, video masih tersedia, dan akunnya publik.",
    );
  }

  return body;
}

/** Susun respons final; wajib ada tautan video (status tunnel/redirect). */
function toMedia(body: CobaltResponse): InstagramMedia {
  if (body.status !== "tunnel" && body.status !== "redirect") {
    throw new HttpError(
      422,
      ErrorCodes.validation,
      "Postingan ini tidak memiliki video yang bisa diunduh (mungkin berisi foto saja).",
    );
  }
  if (typeof body.url !== "string" || !body.url) {
    throw new HttpError(
      422,
      ErrorCodes.validation,
      "Tautan unduh tidak tersedia untuk video ini. Silakan coba lagi.",
    );
  }
  return { url: body.url };
}

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    // Rate limit dulu — endpoint publik, jangan kerjakan apapun untuk spammer.
    const rl = rateLimit(`ig:${clientIp(request.headers)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rl.ok) {
      throw new HttpError(
        429,
        ErrorCodes.tooManyRequests,
        `Terlalu banyak permintaan. Batas ${RATE_LIMIT_MAX}x per menit — coba lagi dalam ${rl.retryAfterSec} detik.`,
      );
    }

    const raw = request.nextUrl.searchParams.get("url")?.trim() ?? "";
    if (!raw) {
      throw new HttpError(
        400,
        ErrorCodes.validation,
        "Parameter `url` wajib diisi dengan link video Instagram.",
      );
    }

    const videoUrl = parseInstagramUrl(raw);
    const body = await fetchFromCobalt(videoUrl);
    return toMedia(body);
  }, (data) => ok(data));
}
