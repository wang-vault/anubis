/**
 * Rate limiter in-memory BEST-EFFORT.
 *
 * Di serverless (Vercel) setiap instance punya memori sendiri → proteksi ini
 * hanya lapisan pengaman tambahan (mis. mencegah satu user spam polling).
 * Proteksi serius (brute-force, bot, floods) harus di edge: gunakan Cloudflare
 * WAF / Rate Limiting rules — lihat docs/cloudflare.md & docs/security.md.
 */
type Bucket = { count: number; resetAt: number };

const store = new Map<string, Bucket>();
const MAX_KEYS = 50_000;

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();

  // Prune sederhana saat store membengkak.
  if (store.size > MAX_KEYS) {
    for (const [k, v] of store) {
      if (v.resetAt <= now) store.delete(k);
    }
  }

  const bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (bucket.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  bucket.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

/** IP pengunjung dari header proxy (Vercel/Cloudflare). */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("cf-connecting-ip") ||
    "unknown"
  );
}
