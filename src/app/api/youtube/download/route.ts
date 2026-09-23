import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ErrorCodes, handleApi, HttpError } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/youtube/download?url=<encoded_url>&filename=<filename>
 *
 * Proxy streaming unduhan video YouTube dari Cobalt instance self-hosted.
 * Menghindari isu cross-origin di browser (file 0 byte saat memakai
 * tag <a href="..." download> langsung ke URL Cobalt).
 *
 * Validasi:
 * - URL harus berasal dari domain Cobalt yang diset di COBALT_API_URL
 * - Rate limit: 10 req / 60 detik per IP
 */

const FETCH_CONNECT_TIMEOUT_MS = 30_000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function errorName(err: unknown): string {
  if (typeof err === "object" && err !== null && "name" in err) {
    return String((err as { name: unknown }).name);
  }
  return "";
}

/**
 * Endpoint Cobalt dari environment.
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
    log.error("youtube_download_cobalt_env_invalid", { reason: "bad_url" });
    throw new HttpError(
      503,
      ErrorCodes.internal,
      "Layanan downloader sedang tidak tersedia. Silakan coba lagi nanti.",
    );
  }
  if (
    parsed.protocol !== "https:" &&
    !(process.env.NODE_ENV !== "production" && parsed.protocol === "http:")
  ) {
    log.error("youtube_download_cobalt_env_invalid", { reason: "not_https" });
    throw new HttpError(
      503,
      ErrorCodes.internal,
      "Layanan downloader sedang tidak tersedia. Silakan coba lagi nanti.",
    );
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Validasi bahwa target URL berasal dari domain Cobalt yang diset di COBALT_API_URL.
 */
function isValidCobaltUrl(rawTargetUrl: string, rawCobaltApiUrl: string): boolean {
  let target: URL;
  let cobalt: URL;

  try {
    target = new URL(rawTargetUrl);
  } catch {
    return false;
  }

  try {
    cobalt = new URL(rawCobaltApiUrl);
  } catch {
    return false;
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return false;
  }

  if (cobalt.protocol === "https:" && target.protocol !== "https:") {
    return false;
  }

  if (target.username || target.password) {
    return false;
  }

  const targetHost = target.hostname.toLowerCase();
  const cobaltHost = cobalt.hostname.toLowerCase();

  const isMatch = targetHost === cobaltHost || targetHost.endsWith(`.${cobaltHost}`);
  if (!isMatch) {
    return false;
  }

  if (cobalt.port !== target.port) {
    return false;
  }

  return true;
}

/**
 * Sanitasi nama file agar aman dimasukkan ke header Content-Disposition.
 */
function sanitizeFilename(raw: string): string {
  const fallback = "video.mp4";
  if (!raw) return fallback;

  let cleaned = raw.split(/[/\\]/).pop()?.trim() || fallback;
  cleaned = cleaned.replace(/["\r\n\t]/g, "").trim();

  // Pastikan hanya karakter ASCII printable agar tidak menyebabkan TypeError di header HTTP
  cleaned = cleaned.replace(/[^\x20-\x7E]/g, "_").trim();

  if (!cleaned) return fallback;

  if (!cleaned.includes(".")) {
    cleaned += ".mp4";
  }

  return cleaned;
}

export async function GET(request: NextRequest) {
  return handleApi(
    async () => {
      // Rate limit: 10 req / 60 detik per IP
      const rl = rateLimit(`yt:${clientIp(request.headers)}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
      if (!rl.ok) {
        throw new HttpError(
          429,
          ErrorCodes.tooManyRequests,
          `Terlalu banyak permintaan. Batas ${RATE_LIMIT_MAX}x per menit — coba lagi dalam ${rl.retryAfterSec} detik.`,
        );
      }

      const targetUrl = request.nextUrl.searchParams.get("url")?.trim() ?? "";
      const filenameParam = request.nextUrl.searchParams.get("filename")?.trim() ?? "";

      if (!targetUrl) {
        throw new HttpError(400, ErrorCodes.validation, "Parameter `url` wajib diisi.");
      }

      const cobaltUrl = cobaltApiUrl();
      if (!isValidCobaltUrl(targetUrl, cobaltUrl)) {
        throw new HttpError(
          400,
          ErrorCodes.validation,
          "URL unduhan tidak valid atau bukan berasal dari domain server downloader yang diizinkan.",
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new Error("TimeoutError"));
      }, FETCH_CONNECT_TIMEOUT_MS);

      const onAbort = () => controller.abort();
      request.signal.addEventListener("abort", onAbort, { once: true });

      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(targetUrl, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; AnubisStore/1.0)",
          },
        });
      } catch (err) {
        if (errorName(err) === "TimeoutError" || errorName(err) === "AbortError") {
          throw new HttpError(
            504,
            ErrorCodes.internal,
            "Waktu tunggu habis. Server downloader tidak merespons — silakan coba lagi.",
          );
        }
        log.errorFrom("youtube_download_fetch_error", err, { url: targetUrl });
        throw new HttpError(
          502,
          ErrorCodes.internal,
          "Gagal menghubungi server downloader. Silakan coba lagi beberapa saat.",
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!upstreamRes.ok) {
        log.warn("youtube_download_upstream_error", {
          status: upstreamRes.status,
          url: targetUrl,
        });
        throw new HttpError(
          upstreamRes.status >= 500 ? 502 : 400,
          upstreamRes.status >= 500 ? ErrorCodes.internal : ErrorCodes.validation,
          "Gagal mengunduh file video dari server downloader.",
        );
      }

      if (!upstreamRes.body) {
        throw new HttpError(
          502,
          ErrorCodes.internal,
          "Tidak ada data video yang diterima dari server downloader.",
        );
      }

      const filename = sanitizeFilename(filenameParam);
      const headers = new Headers();
      headers.set("Content-Disposition", `attachment; filename="${filename}"`);

      const contentType = upstreamRes.headers.get("content-type") || "video/mp4";
      headers.set("Content-Type", contentType);

      const contentLength = upstreamRes.headers.get("content-length");
      if (contentLength) {
        headers.set("Content-Length", contentLength);
      }

      return new NextResponse(upstreamRes.body, {
        status: 200,
        headers,
      });
    },
    (response) => response,
  );
}
