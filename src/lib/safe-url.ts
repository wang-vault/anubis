/**
 * PENYARING URL UNDUHAN (anti-SSRF) untuk route downloader.
 *
 * Dulu route mengunci URL ke origin COBALT_API_URL. Cobalt self-hosted
 * (Railway) kadang mengembalikan tunnel URL dari origin/subdomain yang berbeda,
 * sehingga penguncian itu memblokir unduhan yang sebenarnya valid — stream
 * ditolak 403 dan file yang diterima pengguna berukuran 0B.
 *
 * Gantinya URL disaring seperlunya saja:
 *   1. wajib HTTPS (bukan http://, file://, javascript:, data:, dst), dan
 *   2. bukan alamat lokal/privat, agar route tidak bisa dipakai menembak
 *      jaringan internal atau endpoint metadata cloud.
 *
 * Catatan: fetch bawaan mengikuti redirect, jadi penyaringan ini berlaku untuk
 * URL awal — bukan tujuan akhir bila upstream me-redirect ke alamat internal.
 */

/** Host yang selalu ditolak (loopback / unspecified, termasuk varian IPv6). */
const BLOCKED_HOSTNAMES = new Set(["localhost", "::1", "::", "[::1]", "[::]"]);

/** True untuk IPv4 privat, loopback, link-local, dan 0.0.0.0/8. */
export function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    if (value > 255) return false;
    octets.push(value);
  }

  const [a, b] = octets;
  if (a === undefined || b === undefined) return false;

  if (a === 0) return true; // 0.0.0.0/8 — termasuk 0.0.0.0
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 — termasuk 127.0.0.1
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 — link-local & metadata cloud
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

/** True untuk IPv6 loopback, unique-local (fc00::/7), dan link-local (fe80::/10). */
export function isPrivateIpv6(hostname: string): boolean {
  if (!hostname.startsWith("[") || !hostname.endsWith("]")) return false;
  const address = hostname.slice(1, -1).toLowerCase();
  if (address === "::1" || address === "::") return true;

  // IPv4-mapped bentuk desimal (::ffff:127.0.0.1) maupun heksa (::ffff:7f00:1).
  const dotted = address.split(":").at(-1) ?? "";
  if (dotted.includes(".") && isPrivateIpv4(dotted)) return true;

  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (mapped) {
    const high = Number.parseInt(mapped[1] ?? "", 16);
    const low = Number.parseInt(mapped[2] ?? "", 16);
    return isPrivateIpv4(
      `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`,
    );
  }

  const firstHextet = address.split(":")[0] ?? "";
  if (/^f[cd]/.test(firstHextet)) return true; // fc00::/7
  if (/^fe[89ab]/.test(firstHextet)) return true; // fe80::/10
  return false;
}

/** Tolak host lokal/privat: localhost, loopback, dan rentang IP internal. */
export function isPrivateHost(hostname: string): boolean {
  // Buang titik akhir FQDN ("localhost." → "localhost") lalu samakan huruf.
  const host = hostname.replace(/\.$/, "").toLowerCase();
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return isPrivateIpv4(host) || isPrivateIpv6(host);
}

export type DownloadUrlCheck =
  | { ok: true; url: URL }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Validasi URL unduhan sebelum di-proxy. Pemanggil cukup meneruskan
 * `status` + `error` apa adanya ke klien bila hasilnya tidak ok.
 */
export function checkDownloadUrl(rawUrl: string): DownloadUrlCheck {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, status: 400, error: "URL tidak valid." };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      status: 403,
      error: "URL tidak diizinkan. Hanya tautan HTTPS yang didukung.",
    };
  }

  if (isPrivateHost(url.hostname)) {
    return { ok: false, status: 403, error: "URL tidak diizinkan." };
  }

  return { ok: true, url };
}
