import { confirmManualPaymentAction, rejectManualClaimAction } from "@/app/admin/actions";
import { formatRupiah } from "@/lib/money";
import { ActionButton } from "@/components/ActionButton";
import type { OrderRow } from "@/lib/types";

/**
 * Form verifikasi pembayaran manual (dipakai di detail order admin).
 *
 * Alur penjual: buka mutasi (QRIS statis / rekening / e-wallet) → cari nominal
 * yang ditagihkan → bila cocok tekan "Konfirmasi Pembayaran"; bila klaim buyer
 * tidak ditemukan di mutasi, "Tolak klaim" (buyer boleh konfirmasi ulang).
 *
 * PENTING: tombol konfirmasi tersedia untuk SEMUA order manual yang belum lunas
 * — termasuk yang belum pernah diklaim buyer dan yang sudah kadaluarsa.
 * Pembayaran dikoordinasikan lewat WhatsApp, jadi buyer sering transfer tanpa
 * menekan "Saya sudah transfer" (atau transfer melewati batas waktu). Bila
 * tombol ini hanya muncul setelah klaim, uang yang sudah masuk tidak bisa
 * dicatat penjual dan order akan macet selamanya.
 *
 * Guard role + state machine divalidasi ulang di server action.
 */
export function ManualVerificationForm({ order, back }: { order: OrderRow; back: string }) {
  // Order arsip (STENLY/YOBASEPAY) dan order yang sudah lunas tidak punya aksi
  // di sini; FAILED juga tidak (uang tidak mungkin masuk lewat jalur manual).
  if (order.payment_method !== "MANUAL") return null;
  if (order.payment_status !== "PENDING" && order.payment_status !== "EXPIRED") return null;

  const expected = order.charged_amount ?? order.total_amount;
  const claimed = Boolean(order.manual_claim_at);
  const expired = order.payment_status === "EXPIRED";

  return (
    <section className="paper-inset p-4 text-sm md:col-span-2">
      <h2 className="paper-heading-kicker mb-2">Verifikasi transfer manual</h2>

      {claimed ? (
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
            Klaim buyer BUKAN bukti pembayaran — cocokkan dulu dengan mutasi transfer kamu
            (nominal uniknya tertera di atas).
          </p>
        </div>
      ) : (
        <p className="text-slate-600">
          Buyer belum menekan “Saya sudah transfer” di halaman pembayaran. Karena pembayaran
          dikoordinasikan lewat WhatsApp, itu wajar — kalau uangnya sudah masuk, konfirmasi saja di
          bawah. Nominal yang ditagihkan: <strong className="font-mono">{formatRupiah(expected)}</strong>.
        </p>
      )}

      {expired && (
        <p className="alert-warn mt-3 text-xs leading-5">
          Order ini sudah kadaluarsa. Konfirmasi HANYA bila uang benar-benar sudah masuk dengan
          nominal penuh — setelah dikonfirmasi status order kembali menjadi lunas.
        </p>
      )}

      <form action={confirmManualPaymentAction} className="mt-3 space-y-3">
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
            <p className="hint mt-1">Kosongkan bila sesuai tagihan {formatRupiah(expected)}.</p>
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
        <p className="hint">
          Cocokkan dulu nominal di mutasi (angka uniknya pembeda antar order) — konfirmasi tanpa
          uang masuk membuat order lunas palsu.
        </p>
        <div className="flex flex-wrap gap-2">
          <ActionButton className="btn-primary btn-sm" type="submit" pendingText="Mengonfirmasi…">
            ✓ Konfirmasi Pembayaran Lunas
          </ActionButton>
        </div>
      </form>

      {claimed && (
        <form
          action={rejectManualClaimAction}
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-dotted border-slate-300 pt-3"
        >
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
      )}

      {claimed && order.manual_review_status === "REJECTED" && (
        <p className="hint mt-3">
          Klaim terakhir ditolak{order.manual_review_note ? `: ${order.manual_review_note}` : ""}.
          Buyer dapat konfirmasi ulang sampai batas waktu bayar habis.
        </p>
      )}
    </section>
  );
}
