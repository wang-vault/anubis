/**
 * Tipe & helper monitoring pemakaian token AI (LiteLLM).
 *
 * File ini SENGAJA bebas dari rahasia: hanya berisi bentuk data yang boleh
 * dilihat browser (ringkasan + log yang sudah dinormalisasi). Kredensial
 * LITELLM_API_KEY hanya dibaca di route handler server-side.
 */

export interface AiUsageSummary {
  /** Total biaya (USD) selama periode yang dilaporkan LiteLLM. */
  total_spend: number;
  /** Total token (prompt + completion) dari log yang terbaca. */
  total_tokens: number;
  /** Jumlah request pada log yang terbaca. */
  total_requests: number;
}

export interface AiUsageLog {
  id: string;
  /** ISO-8601, waktu request. */
  created_at: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  /** Biaya request dalam USD. */
  spend: number;
  success: boolean;
}

export interface AiUsagePayload {
  summary: AiUsageSummary;
  logs: AiUsageLog[];
}

/** Respons sukses API: { ok: true, summary, logs }. */
export interface AiUsageResponse extends AiUsagePayload {
  ok: true;
}

export interface ApiErrorResponse {
  error: { code: string; message: string };
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pick(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/**
 * Normalisasi satu baris `GET /spend/logs`. Bentuk field LiteLLM berbeda antar
 * versi (`startTime`/`start_time`, `prompt_tokens`/`input_tokens`, dst), jadi
 * dibaca defensif dan selalu menghasilkan angka yang aman untuk dirender.
 */
export function normalizeLog(raw: unknown, index: number): AiUsageLog {
  const row: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  const usage = typeof row.usage === "object" && row.usage !== null
    ? (row.usage as Record<string, unknown>)
    : {};

  const input = num(
    pick(row, ["prompt_tokens", "input_tokens"]) ??
      pick(usage, ["prompt_tokens", "input_tokens"]),
  );
  const output = num(
    pick(row, ["completion_tokens", "output_tokens"]) ??
      pick(usage, ["completion_tokens", "output_tokens"]),
  );
  const total = num(pick(row, ["total_tokens"]) ?? pick(usage, ["total_tokens"]));
  const status = str(pick(row, ["status", "request_status", "call_status"])).toLowerCase();

  return {
    id: str(pick(row, ["request_id", "id", "call_id"])) || `log-${index}`,
    created_at: str(pick(row, ["startTime", "start_time", "created_at", "endTime"])) || null,
    model: str(pick(row, ["model", "model_name"])) || "unknown",
    input_tokens: input,
    output_tokens: output,
    total_tokens: total > 0 ? total : input + output,
    spend: num(pick(row, ["spend", "cost", "total_cost"])),
    success: status === "" ? true : status === "success" || status === "ok",
  };
}

/** Hitung ringkasan token/request dari daftar log. */
export function summarizeLogs(logs: readonly AiUsageLog[]): {
  total_tokens: number;
  total_requests: number;
} {
  return {
    total_tokens: logs.reduce((acc, l) => acc + l.total_tokens, 0),
    total_requests: logs.length,
  };
}

/** Ambil angka total spend dari respons `GET /spend` (bentuknya bervariasi). */
export function readTotalSpend(raw: unknown): number {
  if (typeof raw === "number" || typeof raw === "string") return num(raw);
  if (Array.isArray(raw)) {
    return raw.reduce<number>((acc, item) => acc + readTotalSpend(item), 0);
  }
  if (typeof raw === "object" && raw !== null) {
    const row = raw as Record<string, unknown>;
    return num(pick(row, ["total_spend", "spend", "totalSpend", "total_cost"]));
  }
  return 0;
}

/** Format USD ringkas untuk tampilan (6 desimal agar biaya kecil terlihat). */
export function formatUsd(value: number): string {
  const digits = value > 0 && value < 0.01 ? 6 : 2;
  return `$${value.toFixed(digits)}`;
}

/** Format angka token dengan pemisah ribuan ID. */
export function formatTokens(value: number): string {
  return new Intl.NumberFormat("id-ID").format(Math.round(value));
}
