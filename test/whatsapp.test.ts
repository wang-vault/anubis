/**
 * PESAN WHATSAPP PEMBAYARAN — modul murni lib/whatsapp.ts.
 *
 * Yang dikunci di sini adalah hal-hal yang membuat penjual tidak perlu bertanya
 * balik dan buyer tidak salah bayar:
 *  - pesan default memuat kode order + nominal yang sudah diformat,
 *  - template dari pengaturan penjual dihormati (placeholder diganti),
 *  - placeholder tak dikenal TIDAK dibuang,
 *  - link wa.me di-encode dengan benar (nomor digit-only, pesan URL-encoded).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYMENT_MESSAGE_TEMPLATE,
  PAYMENT_MESSAGE_PLACEHOLDERS,
  paymentWhatsappUrl,
  renderPaymentMessage,
  transferProofMessage,
  type PaymentMessageVars,
} from "@/lib/whatsapp";

const vars: PaymentMessageVars = {
  storeName: "Toko Saya",
  buyerName: "Budi",
  orderCode: "ORD-20260912-AB7K2M",
  productName: "Kopi Gayo 250g",
  quantity: 2,
  amount: 85042,
};

describe("renderPaymentMessage", () => {
  it("template default memuat kode order, nominal, produk, dan nama", () => {
    const text = renderPaymentMessage(null, vars);
    expect(text).toBe(DEFAULT_PAYMENT_MESSAGE_TEMPLATE.replace("{toko}", "Toko Saya")
      .replace("{kode}", vars.orderCode)
      .replace("{produk}", vars.productName)
      .replace("{jumlah}", "2")
      .replace("{total}", "Rp85.042")
      .replace("{nama}", "Budi"));
    expect(text).toContain("ORD-20260912-AB7K2M");
    expect(text).toContain("Rp85.042");
  });

  it("template kosong / hanya spasi jatuh ke default", () => {
    expect(renderPaymentMessage("   ", vars)).toBe(renderPaymentMessage(undefined, vars));
  });

  it("template milik penjual dipakai apa adanya & placeholder diganti", () => {
    const text = renderPaymentMessage("Order {kode} · {total} · a/n {nama}", vars);
    expect(text).toBe("Order ORD-20260912-AB7K2M · Rp85.042 · a/n Budi");
  });

  it("placeholder tak dikenal dibiarkan (teks penjual tidak hilang)", () => {
    const text = renderPaymentMessage("Halo {toko}, transfer ke {rekening} ya", vars);
    expect(text).toBe("Halo Toko Saya, transfer ke {rekening} ya");
  });

  it("semua placeholder yang didokumentasikan benar-benar diganti", () => {
    const template = PAYMENT_MESSAGE_PLACEHOLDERS.map((p) => p.token).join("|");
    const text = renderPaymentMessage(template, vars);
    expect(text).toBe("Toko Saya|ORD-20260912-AB7K2M|Kopi Gayo 250g|2|Rp85.042|Budi");
  });

  it("nama toko kosong tidak menghasilkan pesan aneh", () => {
    const text = renderPaymentMessage("{toko}", { ...vars, storeName: "" });
    expect(text).toBe("toko");
  });
});

describe("paymentWhatsappUrl", () => {
  it("membuat link wa.me dengan pesan ter-encode", () => {
    const url = paymentWhatsappUrl("6281234567890", vars);
    expect(url.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
    const text = decodeURIComponent(url.split("?text=")[1] ?? "");
    expect(text).toContain("ORD-20260912-AB7K2M");
    expect(text).toContain("Rp85.042");
  });

  it("membersihkan karakter non-digit pada nomor", () => {
    const url = paymentWhatsappUrl("+62 812-3456-7890", vars, "Order {kode}");
    expect(url.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
  });
});

describe("transferProofMessage", () => {
  it("menyebut kode order, nominal, dan nama pengirim", () => {
    const text = transferProofMessage({
      orderCode: "ORD-20260912-AB7K2M",
      amount: 85042,
      buyerName: "Budi",
    });
    expect(text).toContain("ORD-20260912-AB7K2M");
    expect(text).toContain("Rp85.042");
    expect(text).toContain("Budi");
  });
});
