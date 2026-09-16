"use client";

import { useMemo, useState } from "react";
import { checkoutAction, type ActionState } from "@/app/checkout/actions";
import { useActionState } from "react";
import { formatRupiah } from "@/lib/money";
import {
  PAYMENT_METHOD_AUTO,
  PAYMENT_METHOD_MANUAL,
  type AvailablePaymentMethod,
} from "@/lib/payment-methods";

/**
 * Form checkout (komponen klien kecil — hanya untuk qty + preview total).
 * Nilai qty & harga HANYA tampilan: total final dihitung ulang server-side
 * dari database (lihat lib/orders.createOrderForBuyer).
 */
export function CheckoutForm({
  productId,
  productName,
  unitPrice,
  maxQuantity = 20,
  whatsapp,
  methods,
  defaultMethod,
}: {
  productId: string;
  productName: string;
  unitPrice: number;
  maxQuantity?: number;
  whatsapp: string;
  /** Metode yang ditampilkan (termasuk status ongoing). */
  methods: AvailablePaymentMethod[];
  defaultMethod: string;
}) {
  const [qty, setQty] = useState(1);
  const activeMethods = useMemo(() => methods.filter((m) => !m.disabled), [methods]);
  const initialMethod = useMemo(() => {
    const found = methods.find((m) => !m.disabled && m.id === defaultMethod);
    return found ? found.id : (activeMethods[0]?.id ?? PAYMENT_METHOD_MANUAL);
  }, [methods, defaultMethod, activeMethods]);

  const [method, setMethod] = useState<string>(initialMethod);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    checkoutAction,
    {},
  );
  const safeQuantity = clamp(qty, maxQuantity);
  const previewTotal = useMemo(
    () => formatRupiah(unitPrice * safeQuantity),
    [unitPrice, safeQuantity],
  );

  const selected = methods.find((m) => m.id === method && !m.disabled) ?? activeMethods[0];
  /** Nama singkat metode terpilih — dipakai label tombol & catatan di bawah. */
  const selectedShortLabel =
    selected?.id === PAYMENT_METHOD_AUTO ? "QRIS Otomatis" : "Transfer Manual";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="productId" value={productId} />

      <div className="card p-4 sm:p-5">
        <p className="section-kicker">Lembar pemesanan</p>
        <div className="mt-3 flex items-start justify-between gap-3 border-b border-dotted border-slate-300 pb-3">
          <p className="font-serif text-base font-black">{productName}</p>
          <p className="shrink-0 text-sm font-bold text-slate-500">{formatRupiah(unitPrice)}</p>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <label className="text-sm font-bold text-slate-700" htmlFor="qty">
            Jumlah eksemplar
          </label>
          <div className="quantity-control">
            <button
              type="button"
              className="btn-secondary h-9 w-9 p-0 text-lg"
              aria-label="Kurangi jumlah"
              disabled={pending || safeQuantity <= 1}
              onClick={() => setQty((q) => Math.max(1, q - 1))}
            >
              −
            </button>
            <input
              id="qty"
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={maxQuantity}
              value={safeQuantity}
              onChange={(e) => setQty(Number.parseInt(e.target.value, 10) || 1)}
              className="input w-20 text-center"
              aria-label="Jumlah produk"
              disabled={pending}
            />
            <button
              type="button"
              className="btn-secondary h-9 w-9 p-0 text-lg"
              aria-label="Tambah jumlah"
              disabled={pending || safeQuantity >= maxQuantity}
              onClick={() => setQty((q) => Math.min(maxQuantity, q + 1))}
            >
              +
            </button>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t-2 border-double border-slate-700 pt-3 text-sm">
          <span className="font-bold uppercase tracking-wide text-slate-500">Total bayar</span>
          <strong className="font-serif text-xl font-black text-brand-700" aria-live="polite">
            {previewTotal}
          </strong>
        </div>
        <p className="hint">Nominal final dihitung & divalidasi server sesuai harga produk di database.</p>
      </div>

      <fieldset className="card p-4 sm:p-5">
        <legend className="section-kicker">Cara bayar</legend>
        <div className="mt-3 space-y-2">
          {methods.map((m) => {
            const isMethodDisabled = Boolean(m.disabled);
            const checked = !isMethodDisabled && (selected?.id ?? "") === m.id;
            return (
              <label
                key={m.id}
                onClick={(e) => {
                  if (isMethodDisabled) e.preventDefault();
                }}
                className={`flex items-start gap-3 border p-3 transition-colors ${
                  isMethodDisabled
                    ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-80"
                    : checked
                      ? "cursor-pointer border-slate-900 bg-amber-50"
                      : "cursor-pointer border-dotted border-slate-300 bg-white hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={m.id}
                  checked={checked}
                  onChange={() => {
                    if (!isMethodDisabled) setMethod(m.id);
                  }}
                  disabled={pending || isMethodDisabled}
                  className="mt-1 size-4 shrink-0 accent-brand-700"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-800">{m.label}</span>
                    {m.statusBadge && (
                      <span className="inline-flex items-center rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-900">
                        {m.statusBadge}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-500">{m.note}</span>
                </span>
              </label>
            );
          })}
        </div>
        {selected?.id === PAYMENT_METHOD_MANUAL && (
          <p className="hint mt-3">
            Kamu akan melihat instruksi / QR penjual, transfer sendiri dengan nominal persis (termasuk kode
            unik), lalu menekan tombol konfirmasi. Penjual memverifikasi mutasi sebelum pesanan
            diproses.
          </p>
        )}
        {selected?.id === PAYMENT_METHOD_AUTO && (
          <p className="hint mt-3">
            QR dibuat otomatis dengan nominal yang sudah terisi. Setelah kamu membayar, status lunas
            terdeteksi sistem dalam beberapa saat — tidak perlu konfirmasi ke penjual.
          </p>
        )}
      </fieldset>

      <div className="card p-4 sm:p-5">
        <p className="section-kicker">Alamat kabar</p>
        <label className="label mt-3" htmlFor="whatsapp">
          Nomor WhatsApp untuk pengiriman pesanan
        </label>
        <input
          id="whatsapp"
          className="input"
          name="whatsapp"
          inputMode="tel"
          defaultValue={whatsapp}
          required
          disabled={pending}
        />
        <div className="alert-warn mt-3">
          ⚠️ Pastikan nomor WhatsApp <strong>aktif dan benar</strong>. Pesanan dikirim melalui
          WhatsApp ke nomor ini. Kesalahan nomor menjadi tanggung jawab pembeli.
        </div>
      </div>

      {state.error && <p role="alert" className="alert-error">{state.error}</p>}

      <button type="submit" className="btn-primary w-full" disabled={pending || !selected}>
        {pending ? "Menyusun pesanan…" : `Buat Pesanan & Lanjut Bayar (${selectedShortLabel}) →`}
      </button>
      <p className="hint text-center">
        Dengan membayar, kamu menyetujui pesanan diproses manual oleh penjual via WhatsApp.
      </p>
    </form>
  );
}

function clamp(q: number, max: number): number {
  return Math.max(1, Math.min(max, Math.floor(Number.isFinite(q) ? q : 1)));
}
