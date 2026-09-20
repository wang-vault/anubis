"use client";

import { useCallback, useState } from "react";

/**
 * Panel diagnosa QRIS Otomatis (Stenly) — dipakai di /admin/settings.
 *
 * Tujuan: penjual bisa mengetahui PENYEBAB "QR gagal" tanpa membuka Vercel
 * Runtime Logs atau menjalankan curl. Tombol ini memanggil
 * GET /api/admin/payments/diagnose yang menguji kredensial ke provider
 * memakai GET /api/v1/status + order_id karangan → tidak membuat transaksi
 * nyata dan tidak menagih apa pun.
 *
 * Nilai env ditampilkan tersamar (maskSecret di server) — komponen ini tidak
 * pernah menerima rahasia utuh.
 */

type Verdict =
  | "NOT_CONFIGURED"
  | "INVALID_API_KEY"
  | "IP_NOT_ALLOWED"
  | "PROJECT_INACTIVE"
  | "GATEWAY_NOT_READY"
  | "PROVIDER_UNREACHABLE"
  | "BAD_RESPONSE"
  | "OK_KEY_VALID"
  | "UNKNOWN";

interface EnvCheck {
  name: string;
  set: boolean;
  preview?: string;
  note?: string;
}

interface Diagnostics {
  checkedAt: string;
  provider: string;
  configured: boolean;
  sandbox: boolean;
  env: EnvCheck[];
  webhookUrl: string;
  baseUrl: string;
  expiryMinutes: number;
  probe: { attempted: boolean; ok: boolean; message: string | null };
  verdict: Verdict;
  verdictLabel: string;
  hints: string[];
}

export function PaymentDiagnostics() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/diagnose", { cache: "no-store" });
      const json = (await res.json()) as
        | { ok: true; diagnostics: Diagnostics }
        | { error: { code: string; message: string } };
      if (!res.ok || !("diagnostics" in json)) {
        setError(
          "error" in json
            ? json.error.message
            : `Diagnosa gagal (HTTP ${res.status}). Coba lagi beberapa saat.`,
        );
        return;
      }
      setData(json.diagnostics);
    } catch {
      setError("Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  const good = data?.verdict === "OK_KEY_VALID";

  return (
    <section className="card p-5">
      <p className="section-kicker">Diagnosa QRIS Otomatis</p>
      <h2 className="mt-2 text-base font-bold text-slate-800">
        Kenapa QR gagal dibuat?
      </h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">
        Tombol ini menguji secret key, status project, dan IP whitelist langsung ke
        Stenly memakai <span className="font-mono">GET /api/v1/status</span> dengan
        order ID karangan — <strong>tidak membuat transaksi dan tidak menagih apa pun</strong>.
      </p>

      <button
        type="button"
        onClick={() => void run()}
        disabled={loading}
        className="btn-secondary btn-sm mt-3"
      >
        {loading ? "Memeriksa ke provider…" : "Jalankan diagnosa"}
      </button>

      {error && (
        <p className="alert-error mt-3" role="alert">
          {error}
        </p>
      )}

      {data && (
        <div className="mt-4 space-y-4">
          <div className={good ? "alert-info" : "alert-error"} role="status">
            <p className="font-bold">
              {good ? "✓ " : "! "}
              {data.verdictLabel}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Payment Provider: <strong>Stenly</strong> · API:{" "}
              <strong>{data.probe.ok ? "Connected" : data.configured ? "Error" : "Belum dikonfigurasi"}</strong>{" "}
              · Webhook:{" "}
              <strong>{data.configured ? "Configured" : "Belum dikonfigurasi"}</strong>
              {data.sandbox && " · Mode: SANDBOX (sk_test_…)"}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Kode vonis: <span className="font-mono">{data.verdict}</span>
              {data.probe.attempted && data.probe.message && (
                <>
                  {" "}
                  · tanggapan provider: <span className="font-mono">{data.probe.message}</span>
                </>
              )}
              {" "}· diperiksa {new Date(data.checkedAt).toLocaleString("id-ID")}
            </p>
          </div>

          <div>
            <p className="label">Langkah perbaikan</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-600">
              {data.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ol>
          </div>

          <div>
            <p className="label">Environment di sisi website</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-300 text-slate-500">
                    <th className="py-1 pr-3 font-semibold">Variabel</th>
                    <th className="py-1 pr-3 font-semibold">Status</th>
                    <th className="py-1 font-semibold">Nilai (disamarkan)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.env.map((item) => (
                    <tr key={item.name} className="border-b border-dotted border-slate-200 align-top">
                      <td className="py-1.5 pr-3 font-mono text-slate-700">{item.name}</td>
                      <td className="py-1.5 pr-3">
                        <span
                          className={`badge ${item.set ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}
                        >
                          {item.set ? "terisi" : "kosong"}
                        </span>
                        {item.note && (
                          <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">
                            {item.note}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 font-mono text-slate-600">{item.preview ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="paper-inset p-3 text-xs leading-5 text-slate-600">
            <p>
              <strong>Callback URL</strong> yang harus diisi di dashboard Stenly (detail
              project): <span className="font-mono">{data.webhookUrl}</span>
            </p>
            <p className="mt-1">
              <strong>Base URL API</strong>: <span className="font-mono">{data.baseUrl}</span> ·{" "}
              <strong>masa aktif QRIS</strong>: {data.expiryMinutes} menit ·{" "}
              <strong>QR</strong>: dirender lokal dari qr_string
            </p>
            <p className="mt-2 text-slate-500">
              Webhook tidak memengaruhi munculnya QR — ia menentukan apakah order berubah
              jadi PAID otomatis setelah dibayar. Pastikan juga Vercel → Settings →
              Deployment Protection <strong>mati untuk Production</strong>, bila tidak
              webhook akan ditolak 401 sebelum sampai ke aplikasi.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
