import type { OrderStatus, PaymentMethodId, PaymentStatus } from "@/lib/types";

const ORDER_MAP: Record<OrderStatus, { label: string; cls: string }> = {
  PENDING: { label: "Menunggu Pembayaran", cls: "bg-amber-100 text-amber-800" },
  PAID: { label: "Lunas — Siap Diproses", cls: "bg-emerald-100 text-emerald-800" },
  PROCESSING: { label: "Sedang Diproses", cls: "bg-sky-100 text-sky-800" },
  DONE: { label: "Selesai", cls: "bg-slate-200 text-slate-700" },
  EXPIRED: { label: "Kadaluarsa", cls: "bg-red-100 text-red-700" },
};

const PAYMENT_MAP: Record<PaymentStatus, { label: string; cls: string }> = {
  PENDING: { label: "Belum lunas", cls: "bg-amber-100 text-amber-800" },
  PAID: { label: "Lunas ✅", cls: "bg-emerald-100 text-emerald-800" },
  FAILED: { label: "Gagal", cls: "bg-red-100 text-red-700" },
  EXPIRED: { label: "Kadaluarsa", cls: "bg-red-100 text-red-700" },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_MAP[status];
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

const METHOD_MAP: Record<PaymentMethodId, { label: string; cls: string }> = {
  YOBASEPAY: { label: "QRIS Otomatis", cls: "bg-sky-100 text-sky-800" },
  MANUAL: { label: "Transfer Manual", cls: "bg-[#f6e6c8] text-amber-900" },
};

/** Badge metode bayar (memudahkan penjual memisahkan antrian verifikasi). */
export function PaymentMethodBadge({ method }: { method: PaymentMethodId }) {
  const s = METHOD_MAP[method] ?? METHOD_MAP.YOBASEPAY;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const s = PAYMENT_MAP[status];
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}
