"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  saveManualPaymentSettingsAction,
  type AdminActionState,
} from "@/app/admin/actions";
import { ActionButton } from "@/components/ActionButton";
import { DEFAULT_PAYMENT_MESSAGE_TEMPLATE, PAYMENT_MESSAGE_PLACEHOLDERS } from "@/lib/whatsapp";

/**
 * Form pengaturan pembayaran manual via WhatsApp.
 *
 * Yang diatur di sini: nomor WhatsApp penjual (tujuan chat buyer), template
 * pesan yang sudah terisi otomatis, serta teks/expiry yang tampil di checkout.
 * Detail pembayaran (QRIS statis / rekening) TIDAK disimpan di aplikasi —
 * penjual mengirimnya langsung di chat, jadi selalu bisa diperbarui sendiri.
 */
export function WhatsAppPaymentSettingsForm({
  initial,
}: {
  initial: {
    isEnabled: boolean;
    label: string;
    sellerName: string;
    instructions: string;
    expiryMinutes: number;
    whatsappNumber: string;
    messageTemplate: string;
    numberFromEnvFallback: boolean;
    envFallbackDisplay: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(
    saveManualPaymentSettingsAction,
    {},
  );
  const [template, setTemplate] = useState(
    initial.messageTemplate || DEFAULT_PAYMENT_MESSAGE_TEMPLATE,
  );

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
              Aktifkan pembayaran manual via WhatsApp
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-slate-500">
              Bila mati, buyer tidak bisa checkout sama sekali (tidak ada metode lain).
            </span>
          </span>
        </label>

        <div className="mt-4">
          <label className="label" htmlFor="whatsapp_number">
            Nomor WhatsApp penjual (tujuan chat buyer)
          </label>
          <input
            id="whatsapp_number"
            name="whatsapp_number"
            className="input"
            inputMode="tel"
            required
            defaultValue={initial.whatsappNumber}
            placeholder="081234567890"
            disabled={pending}
          />
          <p className="hint mt-1">
            Format bebas: 0812…, +62 812…, atau 62812…. Wajib nomor Indonesia yang aktif — semua
            chat pembayaran masuk ke nomor ini.
          </p>
          {initial.numberFromEnvFallback && initial.envFallbackDisplay && (
            <p className="alert-warn mt-2 text-xs">
              Kolom di atas masih kosong, jadi sementara dipakai <code>WHATSAPP_SELLER_NUMBER</code>{" "}
              dari environment (<strong>{initial.envFallbackDisplay}</strong>). Isi kolom ini agar
              nomor bisa diganti tanpa deploy ulang.
            </p>
          )}
        </div>

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
              Nama penjual (a.n.) — opsional
            </label>
            <input
              id="account_name"
              name="account_name"
              className="input"
              defaultValue={initial.sellerName}
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
            <p className="hint mt-1">
              Setelah lewat, order kadaluarsa. Order yang sudah dikonfirmasi buyer tidak otomatis
              kadaluarsa — keputusan ada di kamu.
            </p>
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
            placeholder="mis. Setelah transfer, kirim screenshot bukti di chat agar cepat diverifikasi."
            disabled={pending}
          />
        </div>
      </div>

      <div className="card p-5">
        <p className="section-kicker">Pesan WhatsApp otomatis</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Saat buyer menekan tombol WhatsApp di halaman pembayaran, chat dibuka dengan pesan ini
          sudah terisi (kode order & nominal ikut otomatis). Kamu tinggal membalas dengan detail
          pembayaran.
        </p>

        <div className="mt-3">
          <label className="label" htmlFor="whatsapp_message_template">
            Template pesan buyer → penjual
          </label>
          <textarea
            id="whatsapp_message_template"
            name="whatsapp_message_template"
            className="input min-h-32 font-mono text-xs"
            maxLength={600}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            disabled={pending}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PAYMENT_MESSAGE_PLACEHOLDERS.map((p) => (
              <button
                key={p.token}
                type="button"
                className="badge bg-slate-200 text-slate-700"
                title={`Sisipkan ${p.desc}`}
                onClick={() => setTemplate((t) => `${t}${t.endsWith(" ") || t.length === 0 ? "" : " "}${p.token}`)}
                disabled={pending}
              >
                {p.token} · {p.desc}
              </button>
            ))}
          </div>
          <p className="hint mt-2">
            Kosongkan untuk memakai template default. Placeholder yang tidak dikenal akan dibiarkan
            apa adanya.
          </p>
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
