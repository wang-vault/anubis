"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatRupiah } from "@/lib/money";
import type { OrderStatus, PaymentStatus, ProductRow } from "@/lib/types";

/**
 * Panel halaman pembayaran (/pay/[orderCode]).
 *
 * - Menampilkan QRIS + instruksi + countdown (dari payment_expired_at).
 * - Sinkron status: polling endpoint /api/payments/status tiap 8 detik.
 *   Endpoint ini membaca DB + (dibatasi 10 dtk) menanyakan ke YoBasePay —
 *   server yang menentukan PAID, BUKAN browser. Webhook tetap sumber utama.
 * - Berhenti polling otomatis saat status final (PAID/DONE/EXPIRED).
 */

export interface PaymentPanelProps {
  order: {
    order_code: string;
    product_name: string;
    quantity: number;
    total_amount: number;
    /** Nominal final provider (total + kode unik). Fallback ke total_amount. */
    charged_amount: number | null;
    payment_status: PaymentStatus;
    order_status: OrderStatus;
    payment_url: string | null;
    qr_image_url: string | null;
    payment_expired_at: string | null;
  };
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
}

const POLL_MS = 8_000;

function pad(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

export function PaymentPanel({ order, product }: PaymentPanelProps) {
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(order.payment_status);
  const [orderStatus, setOrderStatus] = useState<OrderStatus>(order.order_status);
  const [expiredAt, setExpiredAt] = useState<number | null>(
    order.payment_expired_at ? Date.parse(order.payment_expired_at) : null,
  );
  const [remaining, setRemaining] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [chargedAmount, setChargedAmount] = useState<number>(
    order.charged_amount && order.charged_amount > 0 ? order.charged_amount : order.total_amount,
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isFinal = paymentStatus === "PAID" || paymentStatus === "FAILED" || paymentStatus === "EXPIRED";
  const displayAmount = chargedAmount;

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(`/api/payments/status?order=${order.order_code}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as StatusResponse & { ok: boolean };
        setPaymentStatus(data.payment_status);
        setOrderStatus(data.order_status);
        if (data.payment_expired_at) setExpiredAt(Date.parse(data.payment_expired_at));
        if (data.charged_amount && data.charged_amount > 0) {
          setChargedAmount(data.charged_amount);
        } else if (data.total_amount && data.total_amount > 0) {
          setChargedAmount(data.total_amount);
        }
        setLastCheckedAt(Date.now());
      }
    } catch {
      /* jaringan fluktuatif — polling berikutnya akan coba lagi */
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
    timerRef.current = setInterval(checkStatus, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkStatus, isFinal]);

  // Saat countdown habis → sekali cek final ke server (bukan klaim browser).
  useEffect(() => {
    if (remaining === 0 && paymentStatus === "PENDING") {
      void checkStatus();
    }
    
  }, [remaining]);

  const secondsLeft = remaining !== null ? Math.floor(remaining / 1000) : null;
  const timeText =
    secondsLeft !== null ? `${pad(Math.floor(secondsLeft / 60))}:${pad(secondsLeft % 60)}` : null;

  // ------------------------------------------------------------------ PAID
  if (paymentStatus === "PAID") {
    return (
      <div className="card mx-auto max-w-lg p-6 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-brand-100 text-2xl">✅</div>
        <h1 className="mt-3 text-xl font-bold">PEMBAYARAN BERHASIL</h1>
        <p className="mt-1 text-sm text-slate-500">
          Order <strong>#{order.order_code}</strong>
        </p>
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-left text-sm">
          <Row label="Produk" value={`${order.product_name} × ${order.quantity}`} />
          <Row label="Total dibayar" value={formatRupiah(displayAmount)} strong />
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          Pembayaran telah diterima.
          {orderStatus === "DONE"
            ? " Pesanan kamu sudah selesai. Terima kasih! 🎉"
            : " Pesanan sedang diproses oleh penjual. Silakan tunggu pesan melalui WhatsApp."}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href={`/orders/${order.order_code}`} className="btn-primary">
            Lacak Pesanan
          </Link>
          <Link href="/products" className="btn-secondary">
            Belanja Lagi
          </Link>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------- EXPIRED
  if (paymentStatus === "EXPIRED" || paymentStatus === "FAILED") {
    return (
      <div className="card mx-auto max-w-lg p-6 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-red-100 text-2xl">❌</div>
        <h1 className="mt-3 text-xl font-bold">PEMBAYARAN KADALUARSA</h1>
        <p className="mt-2 text-sm text-slate-600">
          Order <strong>#{order.order_code}</strong> melewati batas waktu bayar, dan nominal
          belum kami terima. Silakan buat order baru.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          {product?.is_active && (
            <Link href={`/checkout?product=${product.id}`} className="btn-primary">
              Buat Order Baru
            </Link>
          )}
          <Link href="/orders" className="btn-secondary">
            Riwayat Pesanan
          </Link>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------- PENDING
  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
              ⏳ MENUNGGU PEMBAYARAN
            </p>
            <h1 className="mt-1 text-lg font-bold">Order #{order.order_code}</h1>
          </div>
          {timeText && (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-center">
              <p className="text-[10px] font-semibold uppercase text-amber-700">Bayar dalam</p>
              <p className="font-mono text-lg font-bold leading-6 text-amber-800" role="timer">
                {timeText}
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
          <Row label="Produk" value={`${order.product_name} × ${order.quantity}`} />
          <Row label="Total transfer" value={formatRupiah(displayAmount)} strong />
          {displayAmount !== order.total_amount && (
            <Row label="Harga produk" value={formatRupiah(order.total_amount)} />
          )}
          <Row
            label="Cek terakhir"
            value={lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString("id-ID") : "baru saja"}
          />
        </div>
        {displayAmount !== order.total_amount && (
          <p className="mt-2 text-xs text-slate-500">
            Nominal transfer sudah termasuk kode unik pembayaran agar mutasi mudah dicocokkan.
            Scan QR — angka terisi otomatis.
          </p>
        )}

        <div className="mt-4 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-4 text-center">
          {order.qr_image_url && /^https:\/\//i.test(order.qr_image_url) ? (
            <>
              
              <img
                src={order.qr_image_url}
                alt={`QRIS untuk order ${order.order_code}`}
                width={280}
                height={280}
                className="mx-auto w-64 max-w-full rounded-xl border border-slate-200"
              />
              <p className="mt-3 text-xs text-slate-500">
                Scan QR ini dengan aplikasi apa pun yang mendukung QRIS (m-BCA, Livin, DANA,
                OVO, ShopeePay, GoPay, dll). Nominal sudah terisi otomatis di QR.
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

        <button type="button" onClick={checkStatus} disabled={checking} className="btn-primary mt-4 w-full">
          {checking ? "Mengecek…" : "Cek Status Pembayaran Sekarang"}
        </button>
        <p className="hint mt-2 text-center">
          Halaman ini diperbarui otomatis setiap {POLL_MS / 1000} detik — status lunas ditentukan
          oleh server, tidak perlu manual. Jangan tutup halaman sebelum pembayaran selesai.
        </p>
      </div>

      <Link href={`/orders/${order.order_code}`} className="text-center text-sm text-slate-500 hover:underline">
        Lihat detail pesanan
      </Link>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? "font-bold text-slate-900" : "font-medium text-slate-800"}>{value}</span>
    </div>
  );
}
