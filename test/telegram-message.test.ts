import { describe, expect, it } from "vitest";
import { buildPaidOrderInfo, formatPaidMessage } from "@/lib/integrations/telegram";
import type { OrderRow } from "@/lib/types";

const sample: OrderRow = {
  id: "11111111-1111-4111-8111-111111111111",
  order_code: "ORD-20260911-AB7K2M",
  account_id: "22222222-2222-4222-8222-222222222222",
  product_id: "33333333-3333-4333-8333-333333333333",
  product_name_snapshot: "Kopi Gayo 250g",
  unit_price_snapshot: 85000,
  quantity: 1,
  total_amount: 85000,
  payment_status: "PAID",
  order_status: "PAID",
  payment_id: "YO-ABC12345",
  payment_url: null,
  qr_image_url: null,
  payment_expired_at: null,
  last_payment_checked_at: null,
  paid_at: "2026-09-11T10:00:00Z",
  telegram_notified_at: null,
  buyer_name_snapshot: "Budi",
  buyer_whatsapp_snapshot: "6281234567890",
  buyer_email_snapshot: "budi@example.com",
  created_at: "2026-09-11T09:55:00Z",
  updated_at: "2026-09-11T10:00:00Z",
};

describe("formatPaidMessage", () => {
  it("mengandung seluruh field wajib sesuai spesifikasi", () => {
    const msg = formatPaidMessage(buildPaidOrderInfo(sample));
    expect(msg).toContain("🔔 PESANAN BARU");
    expect(msg).toContain("Order: #ORD-20260911-AB7K2M");
    expect(msg).toContain("Buyer: Budi");
    expect(msg).toContain("WhatsApp: 6281234567890");
    expect(msg).toContain("Produk: Kopi Gayo 250g");
    expect(msg).toContain("Jumlah: 1");
    expect(msg).toContain("Total: Rp85.000");
    expect(msg).toContain("Status: LUNAS ✅");
    expect(msg).toContain("Silakan proses pesanan.");
  });
});
