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
  const previewTotal = useMemo(() => formatRupiah(unitPrice * clamp(qty, maxQuantity)), [qty, unitPrice, maxQuantity]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="productId" value={productId} />

      <div className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">{productName}</p>
          <p className="text-sm text-slate-500">{formatRupiah(unitPrice)}</p>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="text-sm font-medium text-slate-700" htmlFor="qty">
            Jumlah
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary h-9 w-9 p-0 text-lg"
              aria-label="Kurangi jumlah"
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
              value={clamp(qty, maxQuantity)}
              onChange={(e) => setQty(Number.parseInt(e.target.value, 10) || 1)}
              className="input w-20 text-center"
            />
            <button
              type="button"
              className="btn-secondary h-9 w-9 p-0 text-lg"
              aria-label="Tambah jumlah"
              onClick={() => setQty((q) => Math.min(maxQuantity, q + 1))}
            >
              +
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
          <span className="text-slate-500">Total bayar</span>
          <strong className="text-brand-700">{previewTotal}</strong>
        </div>
        <p className="hint">Nominal final dihitung & divalidasi server sesuai harga produk di database.</p>
      </div>

      <div className="card p-4">
        <label className="label" htmlFor="whatsapp">
          Nomor WhatsApp untuk pengiriman pesanan
        </label>
        <input
          id="whatsapp"
          className="input"
          name="whatsapp"
          inputMode="tel"
          defaultValue={whatsapp}
          required
        />
        <div className="alert-warn mt-3">
          ⚠️ Pastikan nomor WhatsApp <strong>aktif dan benar</strong>. Pesanan dikirim melalui
          WhatsApp ke nomor ini. Kesalahan nomor menjadi tanggung jawab pembeli.
        </div>
      </div>

      {state.error && <p role="alert" className="alert-error">{state.error}</p>}

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Membuat pesanan…" : "Buat Pesanan & Bayar QRIS"}
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
