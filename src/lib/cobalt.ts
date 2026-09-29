import "server-only";
import { ErrorCodes, HttpError } from "@/lib/api";
import { log } from "@/lib/logger";

/**
 * KLIEN COBALT #2 — instance self-hosted di Railway.
 *
 * Dipakai bersama oleh /api/pinterest dan /api/soundcloud: keduanya memanggil
 * instance yang SAMA, dengan autentikasi, timeout, dan peta error yang sama
 * persis. Menyalin ~150 baris ke dua route hanya membuat setiap perbaikan bug
 * harus dikerjakan dua kali, jadi bagian itu tinggal di sini; route-nya cukup
 * mengurus validasi URL khas platformnya + bentuk respons.
 *
 * Downloader lama (/api/instagram → `COBALT_API_URL`) sengaja TIDAK diubah —
 * instance #1 dan #2 berdiri sendiri-sendiri.
 *
 * Env (server-only; `import "server-only"` di atas memastikan modul ini tidak
 * pernah ikut ter-bundle ke browser):
 *   COBALT_API_URL_2 — URL instance, wajib https
 *   COBALT_API_KEY_2 — API key instance
 *
 * Kontrak Cobalt:
 *   POST ${COBALT_API_URL_2}  body { url, downloadMode }
 *   → { status: "tunnel" | "redirect", url, filename? }
 */

/** Batas waktu satu panggilan ke Cobalt (spesifikasi: 20 detik). */
export const COBALT_TIMEOUT_MS = 20_000;

/** Mode unduh Cobalt yang dipakai proyek ini. */
export type CobaltDownloadMode = "auto" | "audio" | "mute";

interface CobaltErrorInfo {
  code?: string;
  message?: string;
}

/** Bentuk respons Cobalt (sebagian) — hanya field yang benar-benar dipakai. */
export interface CobaltResponse {
  /** "tunnel" | "redirect" | "local-processing" | "picker" | "error". */
  status?: string;
  /** Tautan file (tunnel Cobalt atau CDN layanan asal). */
  url?: string;
  /** Nama file yang disarankan Cobalt (opsional). */
  filename?: string;
  error?: CobaltErrorInfo;
}

/** Hasil akhir yang dikirim ke browser. */
export interface CobaltMedia {
  url: string;
  filename: string;
}

/** Parameter satu permintaan unduh ke Cobalt. */
export interface CobaltRequest {
  /** Tautan asli milik user — sudah divalidasi & dinormalkan oleh route. */
  sourceUrl: string;
  downloadMode: CobaltDownloadMode;
  /** Prefix nama event log, mis. "pinterest" → `pinterest_upstream_*`. */
  service: string;
  /** Pesan 400 saat Cobalt menolak tautannya (dibuat spesifik per platform). */
  rejectedMessage: string;
}

/** Opsi penyusunan hasil akhir. */
export interface ResolveMediaOptions {
  /** Nama dasar bila Cobalt tidak mengirim `filename`, mis. "pinterest-123". */
  fallbackBaseName: string;
  /** Ekstensi cadangan tanpa titik, mis. "mp3". Kosong = tanpa ekstensi. */
  fallbackExt?: string;
  /** Pesan 422 bila respons Cobalt tidak berisi satu media siap unduh. */
  noMediaMessage: string;
  /** Pesan 422 khusus saat Cobalt mengembalikan banyak media (picker). */
  pickerMessage?: string;
}

/**
 * Satu-satunya pesan untuk masalah KONFIGURASI/kredensial. Sengaja generik:
 * user tidak perlu (dan tidak boleh) tahu env mana yang salah — detailnya
 * hanya ke log Vercel.
 */
const UNAVAILABLE_MESSAGE = "Layanan downloader sedang tidak tersedia. Silakan coba lagi nanti.";

function unavailable(): HttpError {
  return new HttpError(503, ErrorCodes.internal, UNAVAILABLE_MESSAGE);
}

/** Nama error (mis. "TimeoutError") tanpa mengasumsikan err instanceof Error. */
function errorName(err: unknown): string {
  if (typeof err === "object" && err !== null && "name" in err) {
    return String((err as { name: unknown }).name);
  }
  return "";
}

/**
 * Endpoint Cobalt #2 dari environment (wajib, https saja).
 * Tidak diset / salah format → 503 dengan pesan aman untuk user.
 */
function cobaltApiUrl(service: string): string {
  const raw = process.env.COBALT_API_URL_2?.trim() ?? "";
  if (!raw) {
    log.error(`${service}_cobalt_env_missing`, { variable: "COBALT_API_URL_2" });
    throw unavailable();
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    log.error(`${service}_cobalt_env_invalid`, { reason: "bad_url" });
    throw unavailable();
  }
  if (parsed.protocol !== "https:") {
    log.error(`${service}_cobalt_env_invalid`, { reason: "not_https" });
    throw unavailable();
  }

  return raw.replace(/\/+$/, "");
}

/**
 * Header autentikasi Cobalt #2.
 *
 * Cobalt sendiri HANYA membaca `Authorization: Api-Key <key>` (skema Bearer
 * ditolak, tanpa header sama sekali instance membalas
 * 400 `error.api.auth.key.missing`). Header `Api-Key` polos ikut dikirim
 * sesuai spesifikasi fitur ini, supaya instance/proxy yang memang membaca
 * bentuk itu tetap lolos. Keduanya tidak saling mengganggu.
 *
 * Nilai key TIDAK PERNAH di-log dan tidak pernah ikut ke respons.
 */
function authHeaders(): Record<string, string> {
  const key = process.env.COBALT_API_KEY_2?.trim() ?? "";
  if (!key) return {};
  return { Authorization: `Api-Key ${key}`, "Api-Key": key };
}

/**
 * Validasi & normalisasi URL yang diketik user.
 *
 * Ramah-user: bila scheme hilang ("pin.it/abc") dicoba ulang dengan prefix
 * https://. Host & path tetap divalidasi ketat oleh pemanggil setelahnya.
 */
export function parseUserUrl(raw: string, invalidMessage: string): URL {
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
    throw new HttpError(400, ErrorCodes.validation, invalidMessage);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, ErrorCodes.validation, "URL harus diawali http:// atau https://.");
  }
  if (parsed.username || parsed.password) {
    throw new HttpError(400, ErrorCodes.validation, "URL tidak boleh mengandung kredensial (user:pass@host).");
  }
  return parsed;
}

/** Panggil Cobalt #2. Semua kegagalan → HttpError dengan pesan aman + log. */
export async function fetchFromCobalt(req: CobaltRequest): Promise<CobaltResponse> {
  const { sourceUrl, downloadMode, service, rejectedMessage } = req;
  const apiUrl = cobaltApiUrl(service);

  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(COBALT_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({ url: sourceUrl, downloadMode }),
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
    log.errorFrom(`${service}_upstream_fetch_error`, err, { host: apiUrl });
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
    log.errorFrom(`${service}_upstream_invalid_json`, err, { status: res.status });
    throw new HttpError(
      502,
      ErrorCodes.internal,
      "Respons server downloader tidak dapat dibaca. Silakan coba lagi.",
    );
  }

  if (!res.ok || body.status === "error") {
    const code = String(body.error?.code ?? "");
    // Pesan asli Cobalt bisa teknis/bervariasi → simpan di log saja.
    log.warn(`${service}_upstream_api_error`, { status: res.status, code });

    // Key hilang/ditolak = salah konfigurasi SERVER, bukan salah user.
    if (res.status === 401 || res.status === 403 || /auth\.(key|jwt)|auth\.missing/i.test(code)) {
      log.error(`${service}_cobalt_auth_rejected`, { status: res.status, code });
      throw unavailable();
    }
    if (res.status === 429 || /rate|limit/i.test(code)) {
      throw new HttpError(
        503,
        ErrorCodes.internal,
        "Server downloader sedang sibuk (antrean penuh). Tunggu sebentar lalu coba lagi.",
      );
    }
    throw new HttpError(400, ErrorCodes.validation, rejectedMessage);
  }

  return body;
}

/** Ekstensi dari sebuah nama/pathname ("lagu.mp3" → "mp3"), lowercase. */
function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return match?.[1]?.toLowerCase() ?? "";
}

function extensionFromUrl(url: string): string {
  try {
    return extensionOf(new URL(url).pathname);
  } catch {
    return "";
  }
}

/**
 * Nama file aman untuk atribut `download` & tampilan UI.
 * Nama dari Cobalt tidak dipercaya mentah-mentah: buang komponen path, sisakan
 * karakter ASCII yang jinak, dan cegah nama diawali titik (file tersembunyi).
 */
function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  return base
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+/, "")
    .slice(0, 120);
}

function buildFilename(fromCobalt: string | undefined, mediaUrl: string, opts: ResolveMediaOptions): string {
  const provided = typeof fromCobalt === "string" ? sanitizeFilename(fromCobalt) : "";
  // Nama dari Cobalt sudah lengkap dengan ekstensi → pakai apa adanya.
  if (provided && extensionOf(provided)) return provided;

  const base = provided || sanitizeFilename(opts.fallbackBaseName) || "download";
  // Ekstensi hanya ditebak dari sumber yang benar-benar tahu formatnya;
  // kalau tidak ketahuan, lebih baik tanpa ekstensi daripada salah label.
  const ext = extensionFromUrl(mediaUrl) || opts.fallbackExt || "";
  return ext ? `${base}.${ext}` : base;
}

/** Susun respons final; wajib berupa satu media siap unduh (tunnel/redirect). */
export function resolveCobaltMedia(
  body: CobaltResponse,
  service: string,
  opts: ResolveMediaOptions,
): CobaltMedia {
  if (body.status === "picker") {
    throw new HttpError(422, ErrorCodes.validation, opts.pickerMessage ?? opts.noMediaMessage);
  }
  if (body.status !== "tunnel" && body.status !== "redirect") {
    log.warn(`${service}_upstream_unexpected_status`, { status: body.status });
    throw new HttpError(422, ErrorCodes.validation, opts.noMediaMessage);
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || !/^https?:\/\//i.test(url)) {
    log.warn(`${service}_upstream_missing_url`, { status: body.status });
    throw new HttpError(
      422,
      ErrorCodes.validation,
      "Tautan unduh tidak tersedia untuk tautan ini. Silakan coba lagi.",
    );
  }

  return { url, filename: buildFilename(body.filename, url, opts) };
}
