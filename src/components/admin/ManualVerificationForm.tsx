import { confirmManualPaymentAction, rejectManualClaimAction } from "@/app/admin/actions";
import { formatRupiah } from "@/lib/money";
import { ActionButton } from "@/components/ActionButton";
import type { OrderRow } from "@/lib/types";

/**
 * Form verifikasi pembayaran manual (dipakai di detail order admin).
 *
 * Alur penjual: buka mutasi di aplikasi QRIS/merchant → cari nominal yang
 * ditagihkan → bila cocok tekan "Konfirmasi Pembayaran"; bila tidak ada,
 * "Tolak klaim" (buyer boleh konfirmasi ulang).
 *
 * Guard role + state machine divalidasi ulang di server action.
 */
export function ManualVerificationForm({
  order,
  back,
}: {
  order: OrderRow;
  back: string;
}) {
  const expected = order.charged_amount ?? order.total_amount;
  const claimed = Boolean(order.manual_claim_at);

  if (!claimed && order.payment_status !== "PENDING") {
    return null;
  }

  return (
    <section className="paper-inset p-4 text-sm md:col-span-2">
      <h2 className="paper-heading-kicker mb-2">Verifikasi transfer manual</h2>

      {!claimed ? (
        <p className="text-slate-600">
          Buyer belum menekan “Saya sudah transfer”. Nominal yang ditagihkan:{" "}
          <strong className="font-mono">{formatRupiah(expected)}</strong>.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="alert-warn">
            <p className="font-bold">Buyer mengklaim sudah transfer</p>
            <p className="mt-1 text-xs leading-5">
              Nama pengirim: <strong>{order.manual_claim_note || "-"}</strong>
              {order.manual_claim_reference && (
                <>
                  {" "}· No. referensi: <strong>{order.manual_claim_reference}</strong>
                </>
              )}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Klaim buyer BUKAN bukti pembayaran — cocokkan dulu dengan mutasi QRIS kamu.
            </p>
          </div>

          <form action={confirmManualPaymentAction} className="space-y-3">
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="back" value={back} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="receivedAmount">
                  Nominal masuk (opsional)
                </label>
                <input
                  id="receivedAmount"
                  name="receivedAmount"
                  className="input"
                  inputMode="numeric"
                  placeholder={String(expected)}
                  min={order.total_amount}
                />
                <p className="hint mt-1">
                  Kosongkan bila sesuai tagihan {formatRupiah(expected)}.
                </p>
              </div>
              <div>
                <label className="label" htmlFor="confirmNote">
                  Catatan verifikasi (internal)
                </label>
                <input
                  id="confirmNote"
                  name="note"
                  className="input"
                  maxLength={300}
                  placeholder="mis. mutasi GoPay 19:32"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton className="btn-primary btn-sm" type="submit" pendingText="Mengonfirmasi…">
                ✓ Konfirmasi Pembayaran Lunas
              </ActionButton>
            </div>
          </form>

          <form action={rejectManualClaimAction} className="flex flex-wrap items-end gap-2 border-t border-dotted border-slate-300 pt-3">
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="back" value={back} />
            <div className="min-w-0 flex-1">
              <label className="label" htmlFor="rejectNote">
                Alasan penolakan (dilihat buyer)
              </label>
              <input
                id="rejectNote"
                name="note"
                className="input"
                maxLength={300}
                placeholder="mis. nominal tidak ditemukan di mutasi"
              />
            </div>
            <ActionButton className="btn-danger btn-sm" type="submit" pendingText="Menolak…">
              ✕ Tolak Klaim
            </ActionButton>
          </form>

          {order.manual_review_status === "REJECTED" && (
            <p className="hint">
              Klaim terakhir ditolak{order.manual_review_note ? `: ${order.manual_review_note}` : ""}.
              Buyer dapat konfirmasi ulang sampai batas waktu bayar habis.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
