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

/** View order + snapshot buyer (semua data sudah ada di row orders). */
export type AdminOrderView = OrderRow;
