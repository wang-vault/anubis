import type { Metadata } from "next";
import { getManualPaymentView } from "@/lib/payment-config";
import { serverEnv } from "@/lib/env";
import { normalizeWhatsapp } from "@/lib/phone";
import { formatWhatsappDisplay } from "@/lib/phone";
import { WhatsAppPaymentSettingsForm } from "@/components/admin/WhatsAppPaymentSettingsForm";

export const metadata: Metadata = { title: "Pembayaran — Admin" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ saved?: string }>;
}

/**
 * Halaman pengaturan pembayaran penjual.
 *
 * Fokus: pembayaran MANUAL via WhatsApp (satu-satunya metode bayar). Semua
 * nilai di sini disimpan di Supabase #2 → berubah tanpa perlu deploy ulang.
 */
export default async function AdminPaymentSettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const view = await getManualPaymentView();
  const env = serverEnv();
  const envFallback = env.WHATSAPP_SELLER_NUMBER
    ? normalizeWhatsapp(env.WHATSAPP_SELLER_NUMBER)
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="paper-heading">
        <p className="section-kicker">Kantor redaksi · Pembayaran</p>
        <h1 className="paper-heading-title">Pembayaran via WhatsApp</h1>
        <p className="mt-2 text-sm text-slate-500">
          Atur nomor WhatsApp tujuan chat buyer. Detail pembayaran (QRIS statis / rekening /
          e-wallet) kamu kirim langsung di chat. Perubahan berlaku tanpa deploy ulang.
        </p>
      </div>

      {sp.saved && <p className="alert-info">Pengaturan tersimpan ✓</p>}

      <div className="card p-5">
        <p className="section-kicker">Status saat ini</p>
        <div className="mt-3 grid gap-2 text-sm">
          <StatusRow
            ok={view.available}
            label={view.label}
            detail={
              view.reason === "schema_missing"
                ? "Kolom pembayaran manual / nomor WhatsApp belum ada di database — jalankan migrasi (lihat banner merah di atas)."
                : !view.envEnabled
                  ? "Dimatikan lewat env MANUAL_PAYMENT_ENABLED=false."
                  : view.reason === "no_whatsapp"
                    ? "Aktif, tetapi nomor WhatsApp penjual belum diisi → buyer belum bisa checkout."
                    : view.reason === "disabled"
                      ? "Saklar di form bawah sedang mati."
                      : `Tampil di halaman checkout · chat masuk ke ${view.whatsappDisplay ?? "-"}.`
            }
          />
        </div>
        {!view.available && (
          <p className="alert-error mt-3">
            Belum ada metode pembayaran yang bisa dipakai buyer. Isi nomor WhatsApp di bawah lalu
            simpan — checkout baru akan aktif setelah itu.
          </p>
        )}
        <p className="hint mt-3">
          Karena pembayaran manual satu-satunya metode, matikan saklar di bawah hanya bila toko
          memang sedang tutup.
        </p>
      </div>

      <WhatsAppPaymentSettingsForm
        initial={{
          isEnabled: view.isEnabled,
          label: view.label,
          sellerName: view.sellerName,
          instructions: view.instructions,
          expiryMinutes: view.expiryMinutes,
          whatsappNumber: view.whatsappNumber ?? "",
          messageTemplate: view.messageTemplate,
          numberFromEnvFallback: !view.numberFromDatabase && Boolean(view.whatsappNumber),
          envFallbackDisplay: envFallback ? formatWhatsappDisplay(envFallback) : null,
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
