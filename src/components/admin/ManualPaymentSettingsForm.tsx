"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  saveManualPaymentSettingsAction,
  type AdminActionState,
} from "@/app/admin/actions";
import { ActionButton } from "@/components/ActionButton";

/**
 * Form pengaturan pembayaran manual (QRIS statis penjual).
 *
 * Gambar QR di-upload sebagai file → server action menyimpannya base64 di
 * Supabase #2 (tanpa bucket storage). Batas ukuran ditegakkan di server.
 */
export function ManualPaymentSettingsForm({
  initial,
}: {
  initial: {
    isEnabled: boolean;
    label: string;
    accountName: string;
    instructions: string;
    expiryMinutes: number;
    qrSrc: string | null;
    hasUploadedImage: boolean;
    qrIsExternal: boolean;
    maxImageKb: number;
  };
}) {
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(
    saveManualPaymentSettingsAction,
    {},
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");

  const onFile = (file: File | null) => {
    setFileName(file?.name ?? "");
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  };

  const currentSrc = preview ?? initial.qrSrc;

  return (
    <form action={formAction} className="space-y-4">
      <div className="card p-5">
        <p className="section-kicker">Tampilan di checkout</p>
        <label className="mt-3 flex items-start gap-3 border border-dotted border-slate-300 p-3">
          <input
            type="checkbox"
            name="is_enabled"
            defaultChecked={initial.isEnabled}
            className="mt-1 size-4 accent-brand-700"
            disabled={pending}
          />
          <span>
            <span className="block text-sm font-bold text-slate-800">
              Aktifkan metode pembayaran manual
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-slate-500">
              Bila mati, buyer tidak melihat pilihan transfer manual di halaman checkout.
            </span>
          </span>
        </label>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="label">
              Nama metode (tampil ke buyer)
            </label>
            <input
              id="label"
              name="label"
              className="input"
              defaultValue={initial.label}
              maxLength={60}
              required
              disabled={pending}
            />
          </div>
          <div>
            <label className="label" htmlFor="account_name">
              Nama penerima (a.n.)
            </label>
            <input
              id="account_name"
              name="account_name"
              className="input"
              defaultValue={initial.accountName}
              maxLength={80}
              placeholder="mis. Toko Saya"
              disabled={pending}
            />
          </div>
          <div>
            <label className="label" htmlFor="expiry_minutes">
              Batas waktu bayar (menit)
            </label>
            <input
              id="expiry_minutes"
              name="expiry_minutes"
              className="input"
              type="number"
              min={10}
              max={4320}
              defaultValue={initial.expiryMinutes}
              required
              disabled={pending}
            />
            <p className="hint mt-1">Setelah lewat, order otomatis kadaluarsa.</p>
          </div>
        </div>

        <div className="mt-3">
          <label className="label" htmlFor="instructions">
            Instruksi tambahan (opsional)
          </label>
          <textarea
            id="instructions"
            name="instructions"
            className="input min-h-20"
            maxLength={600}
            defaultValue={initial.instructions}
            placeholder={"mis. Gunakan GoPay/OVO/DANA. Setelah transfer, tekan tombol konfirmasi."}
            disabled={pending}
          />
        </div>
      </div>

      <div className="card p-5">
        <p className="section-kicker">Gambar QR</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Unggah gambar QRIS statis kamu (dari aplikasi GoPay Merchant / bank). Gambar disimpan di
          database toko dan disajikan ke buyer lewat <code>/api/manual-qr</code> — tanpa perlu
          hosting atau bucket storage.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]">
          <div className="payment-qr-frame grid place-items-center p-3">
            {currentSrc ? (
              <img
                src={currentSrc}
                alt="Pratinjau QR pembayaran manual"
                width={160}
                height={160}
                className="size-40 border border-slate-300 bg-white object-contain"
              />
            ) : (
              <span className="py-8 text-center text-xs text-slate-400">
                Belum ada
                <br />
                gambar QR
              </span>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="qr_image">
                File QR (PNG/JPG/WebP, maks {initial.maxImageKb} KB)
              </label>
              <input
                id="qr_image"
                name="qr_image"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="input"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                disabled={pending}
              />
              {fileName && <p className="hint mt-1">Dipilih: {fileName}</p>}
              {initial.qrIsExternal && (
                <p className="alert-warn mt-2 text-xs">
                  <code>MANUAL_PAYMENT_QR_IMAGE_URL</code> terisi di environment, jadi URL itu yang
                  dipakai buyer — gambar yang di-upload di sini hanya cadangan.
                </p>
              )}
            </div>

            {initial.hasUploadedImage && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  name="clear_qr"
                  value="1"
                  className="size-4 accent-brand-700"
                  disabled={pending}
                />
                Hapus gambar QR yang tersimpan
              </label>
            )}
          </div>
        </div>
      </div>

      {state.error && (
        <p className="alert-error" role="alert">
          {state.error}
        </p>
      )}

      <ActionButton className="btn-primary w-full sm:w-auto" type="submit" pendingText="Menyimpan…">
        Simpan Pengaturan Pembayaran
      </ActionButton>
    </form>
  );
}
