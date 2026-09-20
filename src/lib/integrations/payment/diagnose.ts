import "server-only";
import { serverEnv, stenlyConfigured, stenlyIsSandbox } from "@/lib/env";
import { log } from "@/lib/logger";
import { getPaymentProvider } from "./index";
import { PaymentProviderError } from "./types";

/**
 * ===========================================================================
 * DIAGNOSA KONEKSI PROVIDER PEMBAYARAN (STENLY) — hanya untuk admin
 * ===========================================================================
 * Masalah "QR gagal" hampir selalu berujung pada satu pesan dari provider yang
 * tidak pernah dilihat penjual (hanya masuk Vercel Runtime Logs sebagai
 * `payment_create_failed.detail`). Modul ini memanggil provider dengan cara
 * yang TANPA EFEK SAMPING dan menerjemahkan jawabannya menjadi vonis + langkah
 * perbaikan, supaya penjual bisa mendiagnosa dari browser.
 *
 * Kenapa memakai `status` (bukan `charge`):
 *   charge membuat TRANSAKSI NYATA di sisi provider. GET /api/v1/status dengan
 *   order_id karangan hanya menguji kredensial: Stenly menjawab 403 (key salah
 *   / project tidak aktif), 403 IP tidak diizinkan, atau 404 "order tidak
 *   ditemukan" — yang terakhir berarti KREDENSIAL BENAR.
 *
 * Keamanan: hanya admin (route memanggil requireAdmin). Nilai rahasia
 * disamarkan — tidak pernah dikembalikan utuh, tidak pernah di-log.
 */

/** order_id karangan: pasti tidak ada di project mana pun. */
const DUMMY_ORDER_ID = "ANUBIS-DIAGNOSTIK-000000";

export type DiagnoseVerdict =
  | "NOT_CONFIGURED"
  | "INVALID_API_KEY"
  | "IP_NOT_ALLOWED"
  | "PROJECT_INACTIVE"
  | "GATEWAY_NOT_READY"
  | "PROVIDER_UNREACHABLE"
  | "BAD_RESPONSE"
  | "OK_KEY_VALID"
  | "UNKNOWN";

export interface EnvCheck {
  name: string;
  set: boolean;
  /** Pratinjau tersamar (bukan nilai utuh) — aman ditampilkan ke admin. */
  preview?: string;
  note?: string;
}

export interface PaymentDiagnostics {
  checkedAt: string;
  provider: string;
  configured: boolean;
  /** true bila memakai key sandbox (sk_test_…). */
  sandbox: boolean;
  env: EnvCheck[];
  /** URL yang harus didaftarkan sebagai Callback URL di dashboard Stenly. */
  webhookUrl: string;
  baseUrl: string;
  expiryMinutes: number;
  probe: { attempted: boolean; ok: boolean; message: string | null };
  verdict: DiagnoseVerdict;
  verdictLabel: string;
  hints: string[];
}

/** Samarkan rahasia: 4 karakter pertama + terakhir, sisanya titik. */
export function maskSecret(value: string): string {
  const v = value.trim();
  if (v.length === 0) return "(kosong)";
  if (v.length <= 8) return `${"*".repeat(Math.max(4, v.length - 1))}…`;
  return `${v.slice(0, 4)}…${v.slice(-4)} (${v.length} karakter)`;
}

function classify(
  err: PaymentProviderError | null,
): { verdict: DiagnoseVerdict; message: string | null } {
  if (!err) return { verdict: "OK_KEY_VALID", message: null };

  const code = err.message;
  const detail =
    typeof err.detail === "string" ? err.detail : err.detail ? String(err.detail) : "";

  if (code === "provider_disabled") return { verdict: "NOT_CONFIGURED", message: detail };
  if (code === "provider_unreachable") return { verdict: "PROVIDER_UNREACHABLE", message: detail };
  if (code === "provider_bad_response") return { verdict: "BAD_RESPONSE", message: detail };

  const msg = detail.toLowerCase();
  // Kredensial diterima; order_id karangan memang tidak ada → hasil BAIK.
  // (Docs §Error: 404 = "Order tidak ditemukan".)
  if (/404/.test(code) || /(not found|tidak ditemukan|order tidak)/.test(msg)) {
    return { verdict: "OK_KEY_VALID", message: detail || "order tidak ditemukan (normal)" };
  }
  if (/(ip .*(allow|whitelist|izin)|not allowed|whitelist)/.test(msg)) {
    return { verdict: "IP_NOT_ALLOWED", message: detail };
  }
  if (/(project .*(aktif|active)|inactive|nonaktif|suspend)/.test(msg)) {
    return { verdict: "PROJECT_INACTIVE", message: detail };
  }
  if (/(api ?key|apikey|unauthorized|authentication|invalid key|forbidden)/.test(msg)) {
    return { verdict: "INVALID_API_KEY", message: detail };
  }
  if (/(gateway|qris|belum siap|not ready|422)/.test(msg)) {
    return { verdict: "GATEWAY_NOT_READY", message: detail };
  }
  // HTTP 401/403 tanpa pesan yang jelas → paling sering API key salah.
  if (/ 40[13]$/.test(code)) return { verdict: "INVALID_API_KEY", message: detail };
  return { verdict: "UNKNOWN", message: detail };
}

const VERDICT_LABELS: Record<DiagnoseVerdict, string> = {
  OK_KEY_VALID: "Kredensial diterima Stenly — secret key & project valid.",
  NOT_CONFIGURED: "Stenly belum dikonfigurasi di sisi website (env kosong).",
  INVALID_API_KEY: "Secret key ditolak Stenly (salah key / bukan milik project ini).",
  IP_NOT_ALLOWED: "IP server ditolak oleh IP Whitelist project.",
  PROJECT_INACTIVE: "Project Stenly tidak aktif.",
  GATEWAY_NOT_READY: "Gateway QRIS project belum siap (konfigurasi di dashboard Stenly).",
  PROVIDER_UNREACHABLE: "Stenly tidak bisa dihubungi dari server (timeout/DNS).",
  BAD_RESPONSE: "Stenly membalas, tetapi bukan JSON yang dikenali.",
  UNKNOWN: "Stenly menolak dengan pesan yang belum dikenali aplikasi.",
};

function hintsFor(verdict: DiagnoseVerdict, webhookUrl: string): string[] {
  switch (verdict) {
    case "OK_KEY_VALID":
      return [
        "Sisi kredensial beres. Bila QR masih belum muncul, buat satu order tes (nominal ≥ Rp1.000) lalu cari di Vercel Runtime Logs: `stenly_qr_string_missing` atau `stenly_qr_unavailable`.",
        `Pastikan Callback URL di dashboard Stenly (detail project) persis: ${webhookUrl}`,
        "Bila QR muncul tetapi order tidak pernah jadi PAID, itu masalah webhook: cek Webhook Logs di dashboard Stenly, cocokkan STENLY_WEBHOOK_SECRET, dan matikan Vercel Deployment Protection untuk Production.",
        "Polling status tetap jalan sebagai cadangan (maks 1×/10 detik per order), jadi status akan tetap tersinkron meski webhook telat.",
      ];
    case "NOT_CONFIGURED":
      return [
        "Isi STENLY_API_KEY (sk_live_… / sk_test_…) dan STENLY_WEBHOOK_SECRET (whsec_…) di Vercel → Settings → Environment Variables.",
        "Keduanya WAJIB terisi: selama salah satu kosong, metode QRIS Otomatis tampil ber-badge “Ongoing” dan tidak bisa dipilih pembeli.",
        "Setelah menyimpan env, lakukan REDEPLOY — perubahan env tidak berlaku pada deployment yang sedang berjalan.",
      ];
    case "INVALID_API_KEY":
      return [
        "Salin ulang Secret Key dari dashboard Stenly → detail project yang benar (satu key hanya berlaku untuk project-nya sendiri).",
        "Pakai SECRET key (sk_live_… / sk_test_…), bukan Public Key (pk_…) dan bukan Webhook Secret (whsec_…).",
        "Periksa tidak ada spasi/kutip yang ikut tersalin ke Vercel, lalu Redeploy.",
      ];
    case "IP_NOT_ALLOWED":
      return [
        "Project Stenly memakai IP Whitelist, sedangkan IP keluar Vercel berubah-ubah.",
        "Buka dashboard Stenly → detail project → IP Whitelist, lalu KOSONGKAN daftar (allow all) atau isi rentang IP yang dipakai hosting-mu.",
        "Pesan error dari Stenly mencantumkan IP yang terdeteksi — pakai itu bila ingin membatasi.",
      ];
    case "PROJECT_INACTIVE":
      return [
        "Aktifkan kembali project di dashboard Stenly, atau pakai key dari project yang aktif.",
        "Pastikan environment project (production/sandbox) cocok dengan prefix key yang kamu pasang.",
      ];
    case "GATEWAY_NOT_READY":
      return [
        "Production menunggu konfigurasi gateway QRIS di sisi Stenly (docs §Error 422).",
        "Untuk mencoba integrasi lebih dulu, buat project sandbox dan pakai key sk_test_… — QR sandbox tidak bisa dibayar sungguhan, tetapi webhook tetap dikirim.",
      ];
    case "PROVIDER_UNREACHABLE":
      return [
        "Coba lagi beberapa menit; bisa jadi gangguan sementara di sisi Stenly.",
        "Pastikan STENLY_BASE_URL benar (default https://stenly.id).",
        "Bila kamu memakai proxy keluar, pastikan request dari server ke stenly.id tidak diblokir.",
      ];
    case "BAD_RESPONSE":
      return [
        "Stenly membalas bukan-JSON: biasanya artinya STENLY_BASE_URL mengarah ke halaman HTML, bukan API.",
        "Pakai nilai default https://stenly.id (adapter menambahkan sendiri /api/v1/…), lalu Redeploy.",
      ];
    default:
      return [
        "Pesan provider di atas belum dikenali aplikasi. Bandingkan dengan tabel error di https://stenly.id/docs (§Error, Retry, dan Operasional).",
        "Uji mandiri: curl https://stenly.id/api/v1/status/ANUBIS-TEST -H \"x-api-key: SECRET_KEY\" — pesan yang sama akan muncul.",
        "Bisa juga dicoba dari Interactive API Console di halaman dokumentasi Stenly.",
      ];
  }
}

/** Hasil satu kali uji kredensial ke provider (tanpa efek samping). */
interface ProbeOutcome {
  probe: PaymentDiagnostics["probe"];
  verdict: DiagnoseVerdict;
}

async function probeProvider(configured: boolean): Promise<ProbeOutcome> {
  if (!configured) {
    return {
      probe: { attempted: false, ok: false, message: null },
      verdict: "NOT_CONFIGURED",
    };
  }
  try {
    const result = await getPaymentProvider().checkStatus(DUMMY_ORDER_ID);
    return {
      probe: { attempted: true, ok: true, message: `status=${String(result.state)}` },
      verdict: "OK_KEY_VALID",
    };
  } catch (err) {
    const providerErr = err instanceof PaymentProviderError ? err : null;
    const classified = classify(providerErr);
    // Pesan provider jauh lebih berguna bagi penjual daripada kode error
    // internal → itu yang ditampilkan. Bukan rahasia: tidak memuat API key.
    const shown =
      classified.message ?? (providerErr ? providerErr.message : "unexpected_error");
    const ok = classified.verdict === "OK_KEY_VALID";
    if (!ok) log.warn("payment_diagnose_failed", { verdict: classified.verdict, message: shown });
    return {
      probe: { attempted: true, ok, message: shown },
      verdict: classified.verdict,
    };
  }
}

/** Jalankan diagnosa (admin-only). Tidak menulis apa pun ke DB/provider. */
export async function diagnosePaymentProvider(): Promise<PaymentDiagnostics> {
  const env = serverEnv();
  const configured = stenlyConfigured(env);
  const origin = new URL(env.NEXT_PUBLIC_SITE_URL).origin;
  const webhookUrl = `${origin}/api/webhooks/stenly`;

  const envChecks: EnvCheck[] = [
    {
      name: "STENLY_API_KEY",
      set: env.STENLY_API_KEY.length > 0,
      preview: maskSecret(env.STENLY_API_KEY),
      note: "Secret key project (sk_live_… / sk_test_…). Dikirim sebagai header x-api-key.",
    },
    {
      name: "STENLY_WEBHOOK_SECRET",
      set: env.STENLY_WEBHOOK_SECRET.length > 0,
      preview: maskSecret(env.STENLY_WEBHOOK_SECRET),
      note: "whsec_… — dipakai memverifikasi X-Stenly-Signature. Tanpa ini metode QRIS disembunyikan.",
    },
    {
      name: "STENLY_BASE_URL",
      set: env.STENLY_BASE_URL.length > 0,
      preview: env.STENLY_BASE_URL,
    },
    {
      name: "STENLY_EXPIRY_MINUTES",
      set: true,
      preview: `${env.STENLY_EXPIRY_MINUTES} menit`,
      note: "Masa aktif QRIS yang dikirim saat create charge (default Stenly: 15).",
    },
    {
      name: "NEXT_PUBLIC_SITE_URL",
      set: env.NEXT_PUBLIC_SITE_URL.length > 0,
      preview: origin,
      note: "Dasar Callback URL yang harus didaftarkan di dashboard Stenly.",
    },
  ];

  const { probe, verdict } = await probeProvider(configured);
  const hints = hintsFor(verdict, webhookUrl);

  return {
    checkedAt: new Date().toISOString(),
    provider: "stenly",
    configured,
    sandbox: stenlyIsSandbox(env),
    env: envChecks,
    webhookUrl,
    baseUrl: env.STENLY_BASE_URL,
    expiryMinutes: env.STENLY_EXPIRY_MINUTES,
    probe,
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    hints,
  };
}
