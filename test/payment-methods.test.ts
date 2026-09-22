import { describe, expect, it } from "vitest";
import {
  LEGACY_PAYMENT_METHOD_AUTO,
  LEGACY_PAYMENT_METHOD_STENLY,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_MANUAL,
  PAYMENT_METHODS,
  isLegacyAutoMethod,
  isManualMethod,
  isStoredPaymentMethod,
  manualAmountAcceptable,
  manualChargedAmount,
  manualUniqueCode,
  normalizePaymentMethod,
  paymentMethodLabel,
} from "@/lib/payment-methods";

describe("SATU metode bayar: MANUAL", () => {
  it("daftar metode hanya berisi MANUAL", () => {
    expect([...PAYMENT_METHODS]).toEqual(["MANUAL"]);
    expect(PAYMENT_METHOD_MANUAL).toBe("MANUAL");
  });

  it("nilai apa pun dari klien tetap dinormalisasi ke MANUAL", () => {
    for (const raw of ["MANUAL", "manual", "STENLY", "YOBASEPAY", "GOPAY", "", null, 42]) {
      expect(normalizePaymentMethod(raw)).toBe("MANUAL");
    }
  });

  it("isManualMethod hanya benar untuk MANUAL", () => {
    expect(isManualMethod("MANUAL")).toBe(true);
    expect(isManualMethod("STENLY")).toBe(false);
    expect(isManualMethod("YOBASEPAY")).toBe(false);
    expect(isManualMethod(null)).toBe(false);
  });
});

describe("nilai arsip (order lama) tetap dikenali", () => {
  it("isStoredPaymentMethod mengenali MANUAL + dua provider lama", () => {
    expect(isStoredPaymentMethod("MANUAL")).toBe(true);
    expect(isStoredPaymentMethod(LEGACY_PAYMENT_METHOD_STENLY)).toBe(true);
    expect(isStoredPaymentMethod(LEGACY_PAYMENT_METHOD_AUTO)).toBe(true);
    expect(isStoredPaymentMethod("GOPAY")).toBe(false);
    expect(isStoredPaymentMethod(null)).toBe(false);
  });

  it("isLegacyAutoMethod menandai QRIS otomatis lama (kapitalisasi diabaikan)", () => {
    expect(isLegacyAutoMethod("STENLY")).toBe(true);
    expect(isLegacyAutoMethod(" yobasepay ")).toBe(true);
    expect(isLegacyAutoMethod("MANUAL")).toBe(false);
    expect(isLegacyAutoMethod(42)).toBe(false);
  });

  it("label aman untuk nilai tak dikenal", () => {
    expect(PAYMENT_METHOD_LABELS.MANUAL).toBe("Transfer Manual (WhatsApp)");
    expect(PAYMENT_METHOD_LABELS.STENLY).toContain("lama");
    expect(paymentMethodLabel("STENLY")).toBe(PAYMENT_METHOD_LABELS.STENLY);
    expect(paymentMethodLabel("MANUAL")).toBe(PAYMENT_METHOD_LABELS.MANUAL);
    expect(paymentMethodLabel("NGACO")).toBe(PAYMENT_METHOD_LABELS.MANUAL);
    expect(paymentMethodLabel(undefined)).toBe(PAYMENT_METHOD_LABELS.MANUAL);
  });
});

describe("manualUniqueCode", () => {
  it("deterministik: kode order sama → kode unik sama", () => {
    const a = manualUniqueCode("ORD-20260912-AB7K2M");
    const b = manualUniqueCode("ORD-20260912-AB7K2M");
    expect(a).toBe(b);
  });

  it("selalu di rentang 1..max", () => {
    for (const code of [
      "ORD-20260912-AB7K2M",
      "ORD-20260912-ZZZZZZ",
      "ORD-20250101-AAAAAA",
      "x",
      "",
    ]) {
      const v = manualUniqueCode(code);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(999);
    }
  });

  it("case-insensitive & toleran spasi (kode dari URL boleh huruf kecil)", () => {
    expect(manualUniqueCode(" ord-20260912-ab7k2m ")).toBe(
      manualUniqueCode("ORD-20260912-AB7K2M"),
    );
  });

  it("max < 1 → 0 (tanpa kode unik)", () => {
    expect(manualUniqueCode("ORD-20260912-AB7K2M", 0)).toBe(0);
  });

  it("menyebar cukup rata untuk order berurutan (bukan konstan)", () => {
    const values = new Set<number>();
    for (let i = 0; i < 50; i++) {
      values.add(manualUniqueCode(`ORD-20260912-AB7K${String(i).padStart(3, "0")}`));
    }
    expect(values.size).toBeGreaterThan(30);
  });
});

describe("manualChargedAmount", () => {
  it("nominal = total + kode unik", () => {
    const amount = manualChargedAmount(50000, "ORD-20260912-AB7K2M");
    expect(amount).toBe(50000 + manualUniqueCode("ORD-20260912-AB7K2M"));
  });

  it("membulatkan total non-integer & tidak pernah negatif", () => {
    expect(manualChargedAmount(1000.9, "ORD-20260912-AB7K2M")).toBe(
      1000 + manualUniqueCode("ORD-20260912-AB7K2M"),
    );
    expect(manualChargedAmount(-500, "ORD-20260912-AB7K2M")).toBe(
      manualUniqueCode("ORD-20260912-AB7K2M"),
    );
  });
});

describe("manualAmountAcceptable", () => {
  const total = 25000;
  it("menerima nominal pas dan nominal + kode unik 1..999", () => {
    expect(manualAmountAcceptable(25000, total)).toBe(true);
    expect(manualAmountAcceptable(25042, total)).toBe(true);
    expect(manualAmountAcceptable(25999, total)).toBe(true);
  });
  it("menolak nominal kurang dari total", () => {
    expect(manualAmountAcceptable(24999, total)).toBe(false);
  });
  it("menolak nominal di atas total + kode unik maksimum", () => {
    expect(manualAmountAcceptable(26000, total)).toBe(false);
  });
  it("menolak NaN", () => {
    expect(manualAmountAcceptable(Number.NaN, total)).toBe(false);
  });
});
