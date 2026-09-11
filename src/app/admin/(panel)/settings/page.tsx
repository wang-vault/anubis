import type { Metadata } from "next";
import { MANUAL_QR_MAX_BYTES, getManualPaymentView } from "@/lib/payment-config";
import { serverEnv, yobasepayConfigured } from "@/lib/env";
import { ManualPaymentSettingsForm } from "@/components/admin/ManualPaymentSettingsForm";

export const metadata: Metadata = { title: "Pembayaran — Admin" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ saved?: string }>;
}

/**
 * Halaman pengaturan pembayaran penjual.
 *
 * Fokus: metode TRANSFER MANUAL (QRIS statis milik penjual). Semua nilai di
 * sini disimpan di Supabase #2 → berubah tanpa perlu deploy ulang.
 */
export default async function AdminPaymentSettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const view = await getManualPaymentView();
  const env = serverEnv();
  const autoConfigured = yobasepayConfigured(env);
  const manualVisibleToBuyer = view.available;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="paper-heading">
        <p className="section-kicker">Kantor redaksi · Pembayaran</p>
        <h1 className="paper-heading-title">Metode pembayaran</h1>
        <p className="mt-2 text-sm text-slate-500">
          Atur QR transfer manual yang dipakai buyer. Perubahan langsung berlaku tanpa deploy ulang.
        </p>
      </div>

      {sp.saved && <p className="alert-info">Pengaturan tersimpan ✓</p>}

      <div className="card p-5">
        <p className="section-kicker">Status saat ini</p>
        <div className="mt-3 grid gap-2 text-sm">
          <StatusRow
            ok={manualVisibleToBuyer}
            label="Transfer Manual (QRIS statis)"
            detail={
              !env.MANUAL_PAYMENT_ENABLED
                ? "Dimatikan lewat env MANUAL_PAYMENT_ENABLED=false."
                : view.reason === "no_qr"
                  ? "Aktif, tetapi gambar QR belum diunggah → buyer belum bisa memilihnya."
                  : view.reason === "disabled"
                    ? "Saklar di form bawah sedang mati."
                    : "Tampil di halaman checkout."
            }
          />
          <StatusRow
            ok={autoConfigured}
            label="QRIS Otomatis (YoBasePay)"
            detail={
              autoConfigured
                ? `Aktif · metode default: ${env.DEFAULT_PAYMENT_METHOD}.`
                : "Tidak aktif — YOBASEPAY_API_KEY / YOBASEPAY_WEBHOOK_SECRET kosong. Metode ini disembunyikan dari buyer sampai diisi."
            }
          />
        </div>
        {!manualVisibleToBuyer && !autoConfigured && (
          <p className="alert-error mt-3">
            Tidak ada metode pembayaran yang bisa dipilih buyer — checkout akan menampilkan
            “Pembayaran belum tersedia”. Unggah gambar QR di bawah lalu simpan.
          </p>
        )}
      </div>

      <ManualPaymentSettingsForm
        initial={{
          isEnabled: view.isEnabled,
          label: view.label,
          accountName: view.accountName,
          instructions: view.instructions,
          expiryMinutes: view.expiryMinutes,
          qrSrc: view.qrSrc,
          hasUploadedImage: view.hasUploadedImage,
          qrIsExternal: Boolean(env.MANUAL_PAYMENT_QR_IMAGE_URL),
          maxImageKb: Math.round(MANUAL_QR_MAX_BYTES / 1024),
        }}
      />
    </div>
  );
}

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-dotted border-slate-300 pb-2 last:border-0">
      <span
        className={`mt-0.5 grid size-5 shrink-0 place-items-center border text-[11px] font-black ${
          ok ? "border-emerald-800 bg-emerald-100 text-emerald-800" : "border-red-900 bg-red-100 text-red-800"
        }`}
        aria-hidden
      >
        {ok ? "✓" : "!"}
      </span>
      <span>
        <span className="block font-bold text-slate-800">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{detail}</span>
      </span>
    </div>
  );
}
