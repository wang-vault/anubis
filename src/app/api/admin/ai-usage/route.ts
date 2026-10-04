import type { NextRequest } from "next/server";
import { handleApi, HttpError, ErrorCodes, ok } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { requireAdmin } from "@/lib/authz";
import { log } from "@/lib/logger";
import {
  normalizeLog,
  readTotalSpend,
  summarizeLogs,
  type AiUsageLog,
  type AiUsagePayload,
} from "@/lib/ai-usage";

export const dynamic = "force-dynamic";

const LOG_LIMIT = 100;
const FETCH_TIMEOUT_MS = 10_000;

/** Ambil base URL LiteLLM (tanpa trailing slash) + API key dari env server. */
function litellmConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = (process.env.LITELLM_API_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.LITELLM_API_KEY ?? "").trim();
  if (!baseUrl || !apiKey) {
    // Nama variabel saja — nilai rahasia TIDAK pernah ikut ke response.
    throw new HttpError(
      503,
      ErrorCodes.internal,
      "Monitoring AI belum dikonfigurasi (LITELLM_API_URL / LITELLM_API_KEY).",
    );
  }
  return { baseUrl, apiKey };
}

/**
 * GET ke LiteLLM dengan Authorization Bearer. Respons mentah provider hanya
 * masuk log server; user cukup tahu endpointnya gagal.
 */
async function litellmGet(path: string): Promise<unknown> {
  const { baseUrl, apiKey } = litellmConfig();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    log.errorFrom("litellm_fetch_failed", err);
    throw new HttpError(
      502,
      ErrorCodes.internal,
      "Tidak bisa menghubungi server LiteLLM. Coba lagi beberapa saat.",
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log.errorFrom(
      "litellm_bad_status",
      new Error(`${path} → ${res.status} ${body.slice(0, 500)}`),
    );
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(
        502,
        ErrorCodes.internal,
        "Kredensial LiteLLM ditolak. Periksa konfigurasi server.",
      );
    }
    throw new HttpError(
      502,
      ErrorCodes.internal,
      "Server LiteLLM mengembalikan error. Coba lagi beberapa saat.",
    );
  }

  try {
    return (await res.json()) as unknown;
  } catch (err) {
    log.errorFrom("litellm_invalid_json", err);
    throw new HttpError(502, ErrorCodes.internal, "Respons LiteLLM tidak valid.");
  }
}

/** Ambil array log dari respons yang bisa berupa array atau { data: [...] }. */
function extractLogs(raw: unknown): AiUsageLog[] {
  const rows = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { data?: unknown }).data)
      ? ((raw as { data: unknown[] }).data)
      : [];
  return rows.slice(0, LOG_LIMIT).map((row, i) => normalizeLog(row, i));
}

/**
 * GET /api/admin/ai-usage
 * Ringkasan biaya + 100 log request terakhir dari LiteLLM. Khusus admin.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return handleApi<AiUsagePayload>(async () => {
    await requireAdmin();

    // Best-effort: cegah polling berlebihan ke LiteLLM dari satu IP.
    const limit = rateLimit(`ai-usage:${clientIp(request.headers)}`, 30, 60_000);
    if (!limit.ok) {
      throw new HttpError(
        429,
        ErrorCodes.tooManyRequests,
        `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfterSec} detik.`,
      );
    }

    const [spendRaw, logsRaw] = await Promise.all([
      litellmGet("/global/spend"),
      litellmGet(`/spend/logs?limit=${LOG_LIMIT}`),
    ]);

    const logs = extractLogs(logsRaw);
    const { total_tokens, total_requests } = summarizeLogs(logs);

    return {
      summary: {
        total_spend: readTotalSpend(spendRaw),
        total_tokens,
        total_requests,
      },
      logs,
    };
  }, (data) => ok(data));
}
