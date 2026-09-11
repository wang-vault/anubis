/** Tipe baris database yang dipakai bersama (cermin dari supabase/*.sql). */

export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED";
export type OrderStatus = "PENDING" | "PAID" | "PROCESSING" | "DONE" | "EXPIRED";
export type ProfileRole = "buyer" | "admin";

export interface ProfileRow {
  id: string;
  name: string;
  email: string;
  whatsapp: string;
  role: ProfileRole;
  created_at: string;
  updated_at: string;
}

export interface ProductRow {
  id: string;
  name: string;
  description: string;
  /** Rupiah (integer). */
  price: number;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrderRow {
  id: string;
  order_code: string;
  account_id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  total_amount: number;
  /**
   * Nominal yang diminta provider (total + kode unik bila ada).
   * null sampai createpayment mengembalikan amount / kolom belum di-migrate.
   */
  charged_amount: number | null;
  payment_status: PaymentStatus;
  order_status: OrderStatus;
  payment_id: string | null;
  payment_url: string | null;
  qr_image_url: string | null;
  payment_expired_at: string | null;
  last_payment_checked_at: string | null;
  paid_at: string | null;
  telegram_notified_at: string | null;
  buyer_name_snapshot: string;
  buyer_whatsapp_snapshot: string;
  buyer_email_snapshot: string;
  created_at: string;
  updated_at: string;
}

/** Field aman untuk diungkap ke buyer via API (tanpa id internal provider, dsb). */
export type BuyerOrderPublic = Pick<
  OrderRow,
  | "order_code"
  | "product_id"
  | "product_name_snapshot"
  | "unit_price_snapshot"
  | "quantity"
  | "total_amount"
  | "charged_amount"
  | "payment_status"
  | "order_status"
  | "payment_url"
  | "qr_image_url"
  | "payment_expired_at"
  | "paid_at"
  | "buyer_name_snapshot"
  | "buyer_whatsapp_snapshot"
  | "created_at"
  | "updated_at"
>;

export function toBuyerOrderPublic(o: OrderRow): BuyerOrderPublic {
  return {
    order_code: o.order_code,
    product_id: o.product_id,
    product_name_snapshot: o.product_name_snapshot,
    unit_price_snapshot: o.unit_price_snapshot,
    quantity: o.quantity,
    total_amount: o.total_amount,
    charged_amount: o.charged_amount ?? null,
    payment_status: o.payment_status,
    order_status: o.order_status,
    payment_url: o.payment_url,
    qr_image_url: o.qr_image_url,
    payment_expired_at: o.payment_expired_at,
    paid_at: o.paid_at,
    buyer_name_snapshot: o.buyer_name_snapshot,
    buyer_whatsapp_snapshot: o.buyer_whatsapp_snapshot,
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}

/** View order + snapshot buyer (semua data sudah ada di row orders). */
export type AdminOrderView = OrderRow;
