"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { claimManualPaymentAction, type ManualClaimState } from "@/app/pay/actions";
import { formatRupiah } from "@/lib/money";
import { isRenderableQrSrc } from "@/lib/qr-image";
import type {
  ManualReviewStatus,
  OrderStatus,
  PaymentMethodId,
  PaymentStatus,
  ProductRow,
} from "@/lib/types";

/**
 * Panel halaman pembayaran (/pay/[orderCode]).
 *
 * Dua tampilan sesuai metode order:
 *  - QRIS otomatis : QR dinamis dari provider + countdown + polling status.
 *  - Transfer manual: QRIS statis penjual + nominal persis (total + kode unik)
 *    + tombol "Saya sudah transfer". Klaim buyer TIDAK mengubah status —
 *    penjual memverifikasi mutasi, lalu status berubah via polling di sini.
 *
 * Sumber kebenaran status SELALU server (endpoint /api/payments/status).
 */

export interface PaymentPanelProps {
  order: {
    order_code: string;
    product_name: string;
    quantity: number;
    total_amount: number;
    /** Nominal final (total + kode unik). Fallback ke total_amount. */
    charged_amount: number | null;
    payment_status: PaymentStatus;
    order_status: OrderStatus;
    payment_method: PaymentMethodId;
    payment_url: string | null;
    qr_image_url: string | null;
    payment_expired_at: string | null;
    manual_claim_at: string | null;
    manual_review_status: ManualReviewStatus | null;
    manual_review_note: string;
  };
  /** Konfigurasi pembayaran manual (null bila metode manual tidak tersedia). */
  manual: {
    label: string;
    accountName: string;
    instructions: string;
    qrSrc: string | null;
  } | null;
  product: ProductRow | null;
}

interface StatusResponse {
  payment_status: PaymentStatus;
  order_status: OrderStatus;
  server_time: string;
  paid_at: string | null;
  payment_expired_at: string | null;
  charged_amount?: number | null;
  total_amount?: number;
  manual_claim_at?: string | null;
  manual_review_status?: ManualReviewStatus | null;
  manual_review_note?: string;
}

const POLL_MS = 8_000;

function pad(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

export function PaymentPanel({ order, manual, product }: PaymentPanelProps) {
  const router = useRouter();
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(order.payment_status);
  const [orderStatus, setOrderStatus] = useState<OrderStatus>(order.order_status);
  const [expiredAt, setExpiredAt] = useState<number | null>(
    order.payment_expired_at ? Date.parse(order.payment_expired_at) : null,
  );
  const [remaining, setRemaining] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [chargedAmount, setChargedAmount] = useState<number>(
    order.charged_amount && order.charged_amount > 0 ? order.charged_amount : order.total_amount,
  );
  // Status klaim pembayaran manual (disinkron dari server saat polling).
  const [claimedAt, setClaimedAt] = useState<string | null>(order.manual_claim_at);
  const [reviewStatus, setReviewStatus] = useState<ManualReviewStatus | null>(
    order.manual_review_status,
  );
  const [reviewNote, setReviewNote] = useState<string>(order.manual_review_note ?? "");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isManual = order.payment_method === "MANUAL";
  const isFinal = paymentStatus === "PAID" || paymentStatus === "FAILED" || paymentStatus === "EXPIRED";
  const displayAmount = chargedAmount;

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(`/api/payments/status?order=${encodeURIComponent(order.order_code)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setCheckError("Status belum dapat diperbarui. Coba lagi sebentar.");
        return;
      }
      const data = (await res.json()) as StatusResponse & { ok: boolean };
      setPaymentStatus(data.payment_status);
      setOrderStatus(data.order_status);
      if (data.payment_expired_at) setExpiredAt(Date.parse(data.payment_expired_at));
      if (data.charged_amount && data.charged_amount > 0) {
        setChargedAmount(data.charged_amount);
      } else if (data.total_amount && data.total_amount > 0) {
        setChargedAmount(data.total_amount);
      }
      if (data.manual_claim_at !== undefined) setClaimedAt(data.manual_claim_at);
      if (data.manual_review_status !== undefined) setReviewStatus(data.manual_review_status);
      if (data.manual_review_note !== undefined) setReviewNote(data.manual_review_note);
      setLastCheckedAt(Date.now());
      setCheckError(null);
    } catch {
      setCheckError("Koneksi sedang tidak stabil. Tombol akan mencoba lagi.");
    } finally {
      setChecking(false);
    }
  }, [order.order_code]);

  // Countdown lokal (1x/detik) untuk sisa waktu bayar.
  useEffect(() => {
    if (!expiredAt || paymentStatus !== "PENDING") {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, expiredAt - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiredAt, paymentStatus]);

  // Polling status — berhenti di status final.
  useEffect(() => {
    if (isFinal) return;
    timerRef.current = setInterval(() => void checkStatus(), POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkStatus, isFinal]);

  // Saat countdown habis → sekali cek final ke server (bukan klaim browser).
  useEffect(() => {
    if (remaining === 0 && paymentStatus === "PENDING") {
      void checkStatus();
    }
  }, [remaining, paymentStatus, checkStatus]);

  const secondsLeft = remaining !== null ? Math.floor(remaining / 1000) : null;
  const timeText =
    secondsLeft !== null ? `${pad(Math.floor(secondsLeft / 60))}:${pad(secondsLeft % 60)}` : null;

  // ------------------------------------------------------------------ PAID
  if (paymentStatus === "PAID") {
    return (
      <div className="container-x">
        <div className="card mx-auto max-w-lg p-6 text-center sm:p-8">
          <div className="mx-auto grid size-14 place-items-center border border-slate-900 bg-[#d3942b] font-serif text-2xl">✓</div>
          <p className="section-kicker mt-4 justify-center">Kabar baik · Pembayaran</p>
          <h1 className="mt-2 text-2xl font-black uppercase">Pembayaran berhasil</h1>
          <p className="mt-1 text-sm text-slate-500">
            Order <strong>#{order.order_code}</strong>
          </p>
          <div className="paper-inset mt-5 p-4 text-left text-sm">
            <Row label="Produk" value={`${order.product_name} × ${order.quantity}`} />
            <Row label="Total dibayar" value={formatRupiah(displayAmount)} strong />
            {isManual && <Row label="Metode" value={manual?.label ?? "Transfer manual"} />}
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            {isManual ? "Transfer kamu sudah diverifikasi penjual." : "Pembayaran telah diterima."}
            {orderStatus === "DONE"
              ? " Pesanan kamu sudah selesai. Terima kasih! 🎉"
              : " Pesanan sedang diproses oleh penjual. Silakan tunggu pesan melalui WhatsApp."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href={`/orders/${order.order_code}`} className="btn-primary">
              Lacak Pesanan →
            </Link>
            <Link href="/products" className="btn-secondary">
              Belanja Lagi
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------- EXPIRED
  if (paymentStatus === "EXPIRED" || paymentStatus === "FAILED") {
    return (
      <div className="container-x">
        <div className="card mx-auto max-w-lg p-6 text-center sm:p-8">
          <div className="mx-auto grid size-14 place-items-center border border-red-900 bg-red-100 font-serif text-2xl text-red-800">!</div>
          <p className="section-kicker mt-4 justify-center">Kabar pembayaran</p>
          <h1 className="mt-2 text-2xl font-black uppercase">
            {paymentStatus === "FAILED" ? "Pembayaran gagal" : "Pembayaran kadaluarsa"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Order <strong>#{order.order_code}</strong> melewati batas waktu bayar atau tidak dapat
            dibuat. Silakan buat order baru.
          </p>
          {isManual && claimedAt && (
            <p className="alert-warn mt-3 text-left text-xs leading-5">
              Kamu sudah melaporkan transfer untuk order ini tetapi belum diverifikasi sampai batas
              waktu habis. Hubungi penjual lewat WhatsApp dengan menyebut kode order{" "}
              <strong>{order.order_code}</strong> agar uangmu bisa dicek.
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {product?.is_active && (
              <Link href={`/checkout?product=${product.id}`} className="btn-primary">
                Buat Order Baru →
              </Link>
            )}
            <Link href="/orders" className="btn-secondary">
              Riwayat Pesanan
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------- PENDING
  return (
    <div className="container-x">
      <div className="mx-auto grid max-w-lg gap-4">
        <div className="card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3 border-b border-dotted border-slate-300 pb-3">
            <div>
              <p className="section-kicker">Halaman pembayaran</p>
              <h1 className="mt-1 font-mono text-sm font-bold text-slate-500">Order #{order.order_code}</h1>
            </div>
            {timeText && (
              <div className="border border-amber-700 bg-amber-50 px-3 py-2 text-center">
                <p className="text-[10px] font-black uppercase text-amber-700">Bayar dalam</p>
                <p className="font-mono text-lg font-bold leading-6 text-amber-800" role="timer">
                  {timeText}
                </p>
              </div>
            )}
          </div>

          <div className="paper-inset mt-4 p-4 text-sm">
            <Row label="Produk" value={`${order.product_name} × ${order.quantity}`} />
            <Row label="Total transfer" value={formatRupiah(displayAmount)} strong />
            {displayAmount !== order.total_amount && (
              <Row label="Harga produk" value={formatRupiah(order.total_amount)} />
            )}
            {isManual && manual?.accountName && <Row label="Penerima" value={manual.accountName} />}
            <Row
              label="Cek terakhir"
              value={lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString("id-ID") : "baru saja"}
            />
          </div>
          {displayAmount !== order.total_amount && (
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Nominal transfer sudah termasuk kode unik pembayaran agar mutasi mudah dicocokkan.
              {isManual ? " Ketik nominal PERSIS seperti di atas." : " Scan QR — angka terisi otomatis."}
            </p>
          )}

          {isManual ? (
            <ManualPaymentSection
              orderCode={order.order_code}
              manual={manual}
              amount={displayAmount}
              claimedAt={claimedAt}
              reviewStatus={reviewStatus}
              reviewNote={reviewNote}
              onClaimed={(at) => {
                setClaimedAt(at);
                setReviewStatus(null);
                setReviewNote("");
                router.refresh();
              }}
            />
          ) : (
            <>
              <div className="payment-qr-frame mt-4">
                {isRenderableQrSrc(order.qr_image_url) ? (
                  <>
                    <img
                      src={order.qr_image_url}
                      alt={`QRIS untuk order ${order.order_code}`}
                      width={280}
                      height={280}
                      className="mx-auto w-64 max-w-full border border-slate-300"
                    />
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      Scan QR ini dengan aplikasi apa pun yang mendukung QRIS. Nominal sudah terisi
                      otomatis di QR.
                    </p>
                  </>
                ) : (
                  <p className="py-6 text-sm text-slate-500">
                    QR tidak tersedia — gunakan tombol “Buka Halaman Pembayaran” di bawah.
                  </p>
                )}
                {order.payment_url && (
                  <a
                    href={order.payment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary mt-3 w-full"
                  >
                    Buka Halaman Pembayaran ↗
                  </a>
                )}
              </div>
            </>
          )}

          {checkError && <p className="alert-error mt-3" role="alert">{checkError}</p>}
          <button type="button" onClick={() => void checkStatus()} disabled={checking} className="btn-primary mt-4 w-full">
            {checking ? "Mengecek status…" : "Cek Status Pembayaran Sekarang"}
          </button>
          <p className="hint mt-2 text-center">
            {isManual
              ? `Status berubah setelah penjual memverifikasi mutasi. Halaman ini mengecek tiap ${POLL_MS / 1000} detik.`
              : `Halaman diperbarui otomatis setiap ${POLL_MS / 1000} detik — status lunas ditentukan oleh server.`}
          </p>
        </div>

        <Link href={`/orders/${order.order_code}`} className="paper-link text-center text-sm font-semibold">
          Lihat detail pesanan →
        </Link>
      </div>
    </div>
  );
}

/**
 * Bagian pembayaran manual: QR statis + nominal + form konfirmasi buyer.
 */
function ManualPaymentSection({
  orderCode,
  manual,
  amount,
  claimedAt,
  reviewStatus,
  reviewNote,
  onClaimed,
}: {
  orderCode: string;
  manual: PaymentPanelProps["manual"];
  amount: number;
  claimedAt: string | null;
  reviewStatus: ManualReviewStatus | null;
  reviewNote: string;
  onClaimed: (claimedAt: string) => void;
}) {
  const [state, formAction, pending] = useActionState<ManualClaimState, FormData>(
    async (prev: ManualClaimState, formData: FormData) => {
      const res = await claimManualPaymentAction(prev, formData);
      if (res.ok && res.claimedAt) onClaimed(res.claimedAt);
      return res;
    },
    {},
  );
  const [copied, setCopied] = useState(false);

  const amountText = String(amount);
  const copyAmount = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(amountText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [amountText]);

  if (!manual) {
    return (
      <p className="alert-error mt-4">
        Pengaturan pembayaran manual belum tersedia. Silakan hubungi penjual.
      </p>
    );
  }

  const hasValidQr = Boolean(manual.qrSrc && isRenderableQrSrc(manual.qrSrc));
  const waiting = Boolean(claimedAt);
  const rejected = reviewStatus === "REJECTED" && !waiting;

  return (
    <div className="mt-4">
      {hasValidQr ? (
        <div className="payment-qr-frame">
          <img
            src={manual.qrSrc!}
            alt={`QRIS statis penjual untuk order ${orderCode}`}
            width={280}
            height={280}
            className="mx-auto w-64 max-w-full border border-slate-300 bg-white"
          />
          <p className="mt-3 text-xs leading-5 text-slate-500">
            {manual.label} — scan dengan aplikasi bank/e-wallet apa pun yang mendukung QRIS
            (GoPay, OVO, DANA, ShopeePay, m-banking).
          </p>
        </div>
      ) : (
        <div className="border border-dashed border-amber-600 bg-amber-50 p-4 text-center">
          <p className="font-serif text-sm font-bold text-amber-900">Transfer Manual ke Rekening / E-Wallet Penjual</p>
          {manual.accountName && (
            <p className="mt-1 text-xs text-slate-700">Atas Nama: <strong>{manual.accountName}</strong></p>
          )}
          <p className="mt-2 text-xs leading-5 text-slate-600">
            {manual.instructions ||
              "Silakan lakukan transfer sesuai nominal persis ke rekening atau e-wallet penjual, lalu isi konfirmasi di bawah."}
          </p>
        </div>
      )}

      <div className="alert-info mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">
          Transfer <strong className="font-mono">{formatRupiah(amount)}</strong> — nominal harus{" "}
          <strong>persis</strong> sampai digit terakhir.
        </span>
        <button type="button" onClick={() => void copyAmount()} className="btn-secondary btn-sm">
          {copied ? "Tersalin ✓" : "Salin nominal"}
        </button>
      </div>

      {hasValidQr && manual.instructions && (
        <p className="hint mt-2 whitespace-pre-line">{manual.instructions}</p>
      )}

      {waiting ? (
        <div className="alert-info mt-4">
          <p className="text-sm font-bold">Konfirmasi kamu sudah kami terima 🙌</p>
          <p className="mt-1 text-xs leading-5">
            Penjual sedang mencocokkan mutasi transfer. Status halaman ini berubah otomatis menjadi
            “Pembayaran berhasil” setelah diverifikasi — biasanya beberapa menit pada jam kerja.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Diklaim pukul{" "}
            {claimedAt ? new Date(claimedAt).toLocaleTimeString("id-ID") : "-"} · order{" "}
            <strong>{orderCode}</strong>
          </p>
        </div>
      ) : (
        <form action={formAction} className="mt-4 space-y-3 border-t border-dotted border-slate-300 pt-4">
          <input type="hidden" name="orderCode" value={orderCode} />
          {rejected && (
            <p className="alert-error" role="alert">
              Konfirmasi kamu ditolak penjual{reviewNote ? `: ${reviewNote}` : ""}. Periksa lagi
              nominal & tujuan transfer, lalu konfirmasi ulang di bawah.
            </p>
          )}
          <div>
            <label className="label" htmlFor="claim-note">
              Nama pengirim / nama di aplikasi (biar mudah dicocokkan)
            </label>
            <input
              id="claim-note"
              name="note"
              className="input"
              maxLength={200}
              placeholder="mis. Budi Santoso (GoPay)"
              disabled={pending}
            />
          </div>
          <div>
            <label className="label" htmlFor="claim-reference">
              Nomor referensi transaksi <span className="font-normal text-slate-400">(opsional)</span>
            </label>
            <input
              id="claim-reference"
              name="reference"
              className="input"
              maxLength={60}
              placeholder="mis. 20260912193045123"
              disabled={pending}
            />
          </div>
          {state.error && <p className="alert-error" role="alert">{state.error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={pending}>
            {pending ? "Mengirim konfirmasi…" : `Saya sudah transfer ${formatRupiah(amount)}`}
          </button>
          <p className="hint text-center">
            Tekan tombol ini SETELAH uang benar-benar terkirim. Penjual memverifikasi mutasi
            sebelum pesanan diproses — konfirmasi palsu membuat order dibatalkan.
          </p>
        </form>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dotted border-slate-300 py-1.5 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? "font-serif font-black text-slate-900" : "font-medium text-slate-800"}>{value}</span>
    </div>
  );
}
