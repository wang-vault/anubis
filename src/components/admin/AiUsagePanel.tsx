"use client";

import { useCallback, useEffect, useState } from "react";
import { StatCard } from "@/components/UiBits";
import { formatDateTimeId } from "@/lib/dates";
import {
  formatTokens,
  formatUsd,
  type AiUsagePayload,
  type AiUsageResponse,
  type ApiErrorResponse,
} from "@/lib/ai-usage";

/**
 * Panel monitoring token AI. Data diambil dari /api/admin/ai-usage (relatif,
 * cookie session ikut otomatis) — browser TIDAK pernah menyentuh LiteLLM
 * maupun LITELLM_API_KEY.
 */
export function AiUsagePanel() {
  const [data, setData] = useState<AiUsagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-usage", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as
        | AiUsageResponse
        | ApiErrorResponse
        | null;
      if (!res.ok || body === null || !("ok" in body)) {
        setError(
          body && "error" in body
            ? body.error.message
            : "Gagal memuat data pemakaian AI. Coba lagi beberapa saat.",
        );
        return;
      }
      setData({ summary: body.summary, logs: body.logs });
    } catch {
      setError("Tidak bisa terhubung ke server. Periksa koneksi kamu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="section-kicker">Ringkasan pemakaian</p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn btn-secondary btn-sm"
        >
          {loading ? "Memuat…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div className="alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Total token dipakai"
          value={data ? formatTokens(data.summary.total_tokens) : "—"}
        />
        <StatCard
          label="Total biaya (USD)"
          value={data ? formatUsd(data.summary.total_spend) : "—"}
          accent="text-brand-700"
        />
        <StatCard
          label="Total request"
          value={data ? formatTokens(data.summary.total_requests) : "—"}
        />
      </div>

      <section className="space-y-3">
        <div>
          <p className="section-kicker">Catatan permintaan</p>
          <h2 className="font-serif text-xl font-black">100 request terakhir</h2>
          <p className="hint">
            Diambil langsung dari LiteLLM saat halaman dimuat atau saat kamu menekan Refresh.
          </p>
        </div>

        {loading && !data ? (
          <div className="card p-6 text-sm text-slate-500">Memuat log pemakaian…</div>
        ) : !data || data.logs.length === 0 ? (
          <div className="paper-empty p-8 text-center text-sm text-slate-500">
            Belum ada log request AI pada periode ini.
          </div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-900 text-left">
                  <th className="px-3 py-2 font-bold">Tanggal</th>
                  <th className="px-3 py-2 font-bold">Model</th>
                  <th className="px-3 py-2 text-right font-bold">Token input</th>
                  <th className="px-3 py-2 text-right font-bold">Token output</th>
                  <th className="px-3 py-2 text-right font-bold">Biaya</th>
                  <th className="px-3 py-2 font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((row) => (
                  <tr key={row.id} className="border-b border-dotted border-slate-300">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                      {row.created_at ? formatDateTimeId(row.created_at) : "-"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.model}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatTokens(row.input_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatTokens(row.output_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUsd(row.spend)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`badge ${row.success ? "text-emerald-700" : "text-red-700"}`}
                      >
                        {row.success ? "Sukses" : "Gagal"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
