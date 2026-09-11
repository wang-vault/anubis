import { describe, expect, it } from "vitest";
import {
  buildManualClaimInfo,
  buildPaidOrderInfo,
  formatManualClaimMessage,
  formatPaidMessage,
} from "@/lib/integrations/telegram";
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
  charged_amount: 85042,
  payment_status: "PAID",
  order_status: "PAID",
  payment_method: "YOBASEPAY",
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
  manual_claim_at: null,
  manual_claim_note: "",
  manual_claim_reference: "",
  manual_claim_notified_at: null,
  manual_reviewed_at: null,
  manual_reviewed_by: null,
  manual_review_status: null,
  manual_review_note: "",
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

const manualSample: OrderRow = {
  ...sample,
  order_code: "ORD-20260912-MANU4L",
  payment_method: "MANUAL",
  payment_id: null,
  total_amount: 50000,
  charged_amount: 50417,
  payment_status: "PENDING",
  order_status: "PENDING",
  paid_at: null,
  manual_claim_at: "2026-09-12T12:30:00Z",
  manual_claim_note: "Budi Santoso (GoPay)",
  manual_claim_reference: "20260912193045123",
};

describe("formatManualClaimMessage", () => {
  it("memuat order, nominal tagihan, dan data klaim buyer", () => {
    const msg = formatManualClaimMessage(buildManualClaimInfo(manualSample));
    expect(msg).toContain("🧾 KLAIM TRANSFER MANUAL");
    expect(msg).toContain("Order: #ORD-20260912-MANU4L");
    expect(msg).toContain("Ditagihkan: Rp50.417");
    expect(msg).toContain("No. referensi: 20260912193045123");
    expect(msg).toContain("Catatan buyer: Budi Santoso (GoPay)");
    // Zona WIB: 12:30 UTC = 19:30 WIB.
    expect(msg).toContain("19.30 WIB");
    expect(msg).toContain("Konfirmasi Pembayaran");
  });

  it("tidak mencantumkan baris kosong untuk data opsional yang tidak diisi", () => {
    const msg = formatManualClaimMessage(
      buildManualClaimInfo({ ...manualSample, manual_claim_note: "", manual_claim_reference: "" }),
    );
    expect(msg).not.toContain("No. referensi:");
    expect(msg).not.toContain("Catatan buyer:");
  });
});

describe("formatPaidMessage (metode manual)", () => {
  it("menandai order hasil verifikasi manual", () => {
    const msg = formatPaidMessage(buildPaidOrderInfo({ ...manualSample, payment_status: "PAID" }));
    expect(msg).toContain("Metode: Transfer manual (sudah kamu verifikasi) 🧾");
    expect(msg).toContain("Status: LUNAS ✅");
  });

  it("order QRIS otomatis tetap memakai label provider", () => {
    const msg = formatPaidMessage(buildPaidOrderInfo(sample));
    expect(msg).toContain("Metode: QRIS Otomatis");
  });
});
