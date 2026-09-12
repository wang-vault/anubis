import "server-only";
import { serverEnv, yobasepayConfigured } from "@/lib/env";
import { log } from "@/lib/logger";
import { getPaymentProvider } from "./index";
import { PaymentProviderError } from "./types";

/**
 * ===========================================================================
 * DIAGNOSA KONEKSI PROVIDER PEMBAYARAN — hanya untuk admin
 * ===========================================================================
 * Masalah "QR gagal" hampir selalu berujung pada satu pesan dari provider yang
 * tidak pernah dilihat penjual (hanya masuk Vercel Runtime Logs sebagai
 * `payment_create_failed.detail`). Modul ini memanggil provider dengan cara
 * yang TANPA EFEK SAMPING dan menerjemahkan jawabannya menjadi vonis + langkah
 * perbaikan, supaya penjual bisa mendiagnosa dari browser.
 *
 * Kenapa memakai `checkstatus` (bukan `createpayment`):
 *   createpayment membuat TRANSAKSI NYATA di sisi provider (dan berpotensi
 *   memotong flat fee saldo YC). checkstatus dengan trxid karangan hanya
 *   menguji kredensial + domain lock: provider akan menjawab "Invalid API Key"
 *   (kredensial salah) atau "transaksi tidak ditemukan" (kredensial BENAR).
 *
 * Keamanan: hanya admin (route memanggil requireAdmin). Nilai rahasia
 * disamarkan — tidak pernah dikembalikan utuh, tidak pernah di-log.
 */

/** trxid karangan: cukup nyata untuk diuji, pasti tidak ada di provider. */
const DUMMY_TRX_ID = "YO-DIAGNOSTIK-000000";

export type DiagnoseVerdict =
  | "NOT_CONFIGURED"
  | "INVALID_API_KEY"
  | "DOMAIN_LOCK"
  | "INSUFFICIENT_BALANCE"
  | "PLAN_MISMATCH"
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
  env: EnvCheck[];
  /** Origin yang dikirim sebagai header Origin/Referer = harus = Domain Lock. */
  domainLock: string;
  /** URL yang harus didaftarkan di dashboard YoBasePay → menu Webhook. */
  webhookUrl: string;
  baseUrl: string;
  amountTolerance: number;
  qrRenderConfigured: boolean;
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
  // Kredensial diterima; trxid karangan memang tidak ada → ini hasil BAIK.
  if (/(not found|tidak (di)?temukan|unknown trx|invalid trx|no transaction|trxid)/.test(msg)) {
    return { verdict: "OK_KEY_VALID", message: detail };
  }
  if (/(api ?key|apikey|token|unauthorized|auth)/.test(msg)) {
    return { verdict: "INVALID_API_KEY", message: detail };
  }
  if (/(domain|origin|referer|referrer|lock|host)/.test(msg)) {
    return { verdict: "DOMAIN_LOCK", message: detail };
  }
  if (/(saldo|balance|insufficient|kurang|top ?up|yc)/.test(msg)) {
    return { verdict: "INSUFFICIENT_BALANCE", message: detail };
  }
  if (/(plan|paket|upgrade|premium|not active|tidak aktif|forbidden|permission|access)/.test(msg)) {
    return { verdict: "PLAN_MISMATCH", message: detail };
  }
  return { verdict: "UNKNOWN", message: detail };
}

const VERDICT_LABELS: Record<DiagnoseVerdict, string> = {
  OK_KEY_VALID: "Kredensial diterima provider — API key & domain lock benar.",
  NOT_CONFIGURED: "YoBasePay belum dikonfigurasi di sisi website (env kosong).",
  INVALID_API_KEY: "API key ditolak provider.",
  DOMAIN_LOCK: "Domain Lock menolak request dari domain ini.",
  INSUFFICIENT_BALANCE: "Saldo YC tidak cukup untuk biaya transaksi.",
  PLAN_MISMATCH: "Paket/API di akunmu tidak mengizinkan panggilan ini.",
  PROVIDER_UNREACHABLE: "Provider tidak bisa dihubungi dari server (timeout/DNS).",
  BAD_RESPONSE: "Provider membalas, tetapi bukan JSON yang dikenali.",
  UNKNOWN: "Provider menolak dengan pesan yang belum dikenali aplikasi.",
};

function hintsFor(verdict: DiagnoseVerdict, domainLock: string): string[] {
  switch (verdict) {
    case "OK_KEY_VALID":
      return [
        "Sisi kredensial beres. Bila QR masih belum muncul, penyebabnya ada di BENTUK DATA QR yang dikirim provider.",
        "Buat satu order tes (nominal Rp10.000–50.000), lalu cari di Vercel Runtime Logs: `yobasepay_qr_missing` atau `yobasepay_qr_payload_only` — keduanya mencetak daftar nama field yang dikirim provider.",
        "Bila log menyebut `yobasepay_qr_payload_only`, provider mengirim string QRIS (bukan gambar): isi env YOBASEPAY_QR_RENDER_URL dengan template https yang memuat {payload}.",
        "Bila QR muncul tetapi order tidak pernah jadi PAID, itu masalah webhook — cek URL webhook & secret, dan matikan Vercel Deployment Protection untuk Production.",
      ];
    case "NOT_CONFIGURED":
      return [
        "Isi YOBASEPAY_API_KEY dan YOBASEPAY_WEBHOOK_SECRET di Vercel → Settings → Environment Variables.",
        "Keduanya WAJIB terisi: selama salah satu kosong, metode QRIS Otomatis disembunyikan dari checkout (lihat yobasepayConfigured()).",
        "Setelah menyimpan env, lakukan REDEPLOY — perubahan env tidak berlaku pada deployment yang sedang berjalan.",
      ];
    case "INVALID_API_KEY":
      return [
        "Salin ulang API Key dari dashboard YoBasePay → project yang benar.",
        "Pastikan key itu milik API V1: aplikasi memanggil GET ?action=createpayment (endpoint V1). Key V4/MyPG bisa jadi tidak berlaku di endpoint ini.",
        "Periksa tidak ada spasi/kutip yang ikut tersalin ke Vercel, lalu Redeploy.",
      ];
    case "DOMAIN_LOCK":
      return [
        `Daftarkan domain ini persis di dashboard YoBasePay → Domain Lock: ${domainLock}`,
        "Nilai itu diambil dari env NEXT_PUBLIC_SITE_URL dan dikirim sebagai header Origin/Referer.",
        "Pastikan tidak ada selisih skema (http vs https), trailing slash, atau subdomain. Setelah diubah di dashboard, coba lagi (tanpa perlu redeploy).",
        "Bila NEXT_PUBLIC_SITE_URL masih localhost padahal ini produksi, perbaiki env-nya lalu Redeploy.",
      ];
    case "INSUFFICIENT_BALANCE":
      return [
        "Top up saldo YC di dashboard YoBasePay — setiap transaksi memotong flat fee (Starter: YC 500) selain fee persentase.",
        "Setelah saldo terisi, jalankan diagnosa ini lagi; tidak perlu redeploy.",
      ];
    case "PLAN_MISMATCH":
      return [
        "Buka dashboard YoBasePay → paket/API yang aktif untuk akunmu.",
        "Paket Starter hanya mengaktifkan API V1. Endpoint yang dipakai aplikasi adalah V1 (GET ?action=createpayment).",
        "Bila akunmu memakai V4 Multi-Channel (POST /api/v4/create-transaction) atau MyPG, adapter perlu disesuaikan: src/lib/integrations/payment/yobasepay.ts (satu file, logika bisnis tidak berubah).",
      ];
    case "PROVIDER_UNREACHABLE":
      return [
        "Periksa status layanan YoBasePay (menu Status di situs mereka) dan coba lagi beberapa menit.",
        "Pastikan YOBASEPAY_BASE_URL benar (default https://yobasepay.net/api).",
        "Bila kamu memakai Cloudflare/proxy keluar, pastikan request dari Vercel ke yobasepay.net tidak diblokir.",
      ];
    case "BAD_RESPONSE":
      return [
        "Provider membalas bukan-JSON: biasanya artinya YOBASEPAY_BASE_URL mengarah ke halaman HTML (bukan endpoint API).",
        "Coba nilai default https://yobasepay.net/api, atau salin base URL dari menu Docs di dashboard akunmu, lalu Redeploy.",
      ];
    default:
      return [
        "Pesan provider di atas belum dikenali aplikasi. Salin pesan itu dan bandingkan dengan menu Docs di dashboard YoBasePay.",
        "Uji mandiri dari laptop: curl \"https://yobasepay.net/api?action=checkstatus&apikey=APIKEY&trxid=YO-TEST\" — pesan yang sama akan muncul.",
        "Bila ternyata akunmu memakai versi API lain (V4/MyPG), sampaikan bentuk request/response-nya agar adapter disesuaikan.",
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
    const result = await getPaymentProvider().checkStatus(DUMMY_TRX_ID);
    return {
      probe: { attempted: true, ok: true, message: `status=${String(result.state)}` },
      verdict: "OK_KEY_VALID",
    };
  } catch (err) {
    const providerErr = err instanceof PaymentProviderError ? err : null;
    const classified = classify(providerErr);
    // Pesan provider ("Invalid API Key", "Saldo tidak cukup", …) jauh lebih
    // berguna bagi penjual daripada kode error internal → itu yang ditampilkan.
    // Bukan rahasia: tidak memuat API key/secret, hanya teks dari provider.
    const shown =
      classified.message ?? (providerErr ? providerErr.message : "unexpected_error");
    log.warn("payment_diagnose_failed", { verdict: classified.verdict, message: shown });
    return {
      probe: { attempted: true, ok: false, message: shown },
      verdict: classified.verdict,
    };
  }
}

/** Jalankan diagnosa (admin-only). Tidak menulis apa pun ke DB/provider. */
export async function diagnosePaymentProvider(): Promise<PaymentDiagnostics> {
  const env = serverEnv();
  const configured = yobasepayConfigured(env);
  const domainLock = new URL(env.NEXT_PUBLIC_SITE_URL).origin;

  const envChecks: EnvCheck[] = [
    {
      name: "YOBASEPAY_API_KEY",
      set: env.YOBASEPAY_API_KEY.length > 0,
      preview: maskSecret(env.YOBASEPAY_API_KEY),
    },
    {
      name: "YOBASEPAY_WEBHOOK_SECRET",
      set: env.YOBASEPAY_WEBHOOK_SECRET.length > 0,
      preview: maskSecret(env.YOBASEPAY_WEBHOOK_SECRET),
      note: "Wajib terisi walau webhook belum dipakai — tanpanya metode QRIS disembunyikan.",
    },
    {
      name: "NEXT_PUBLIC_SITE_URL",
      set: env.NEXT_PUBLIC_SITE_URL.length > 0,
      preview: domainLock,
      note: "Dikirim sebagai header Origin/Referer → harus sama dengan Domain Lock di dashboard.",
    },
    {
      name: "YOBASEPAY_BASE_URL",
      set: env.YOBASEPAY_BASE_URL.length > 0,
      preview: env.YOBASEPAY_BASE_URL,
    },
    {
      name: "YOBASEPAY_QR_RENDER_URL",
      set: Boolean(env.YOBASEPAY_QR_RENDER_URL),
      preview: env.YOBASEPAY_QR_RENDER_URL ?? "(kosong)",
      note: "Dipakai hanya bila provider mengirim payload QRIS, bukan gambar.",
    },
  ];

  const { probe, verdict } = await probeProvider(configured);
  const hints = hintsFor(verdict, domainLock);

  return {
    checkedAt: new Date().toISOString(),
    provider: "yobasepay",
    configured,
    env: envChecks,
    domainLock,
    webhookUrl: `${domainLock}/api/webhooks/yobasepay`,
    baseUrl: env.YOBASEPAY_BASE_URL,
    amountTolerance: env.YOBASEPAY_AMOUNT_TOLERANCE,
    qrRenderConfigured: Boolean(env.YOBASEPAY_QR_RENDER_URL),
    probe,
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    hints,
  };
}
