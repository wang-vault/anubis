"use client";

import { useMemo, useState } from "react";
import { checkoutAction, type ActionState } from "@/app/checkout/actions";
import { useActionState } from "react";
import { formatRupiah } from "@/lib/money";

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
}: {
  productId: string;
  productName: string;
  unitPrice: number;
  maxQuantity?: number;
  whatsapp: string;
}) {
  const [qty, setQty] = useState(1);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    checkoutAction,
    {},
  );
  const safeQuantity = clamp(qty, maxQuantity);
  const previewTotal = useMemo(
    () => formatRupiah(unitPrice * safeQuantity),
    [unitPrice, safeQuantity],
  );

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

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Menyusun pesanan…" : "Buat Pesanan & Bayar QRIS →"}
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
