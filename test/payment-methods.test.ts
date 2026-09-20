import { describe, expect, it } from "vitest";
import {
  isAutoMethod,
  isManualMethod,
  isPaymentMethod,
  manualAmountAcceptable,
  manualChargedAmount,
  manualUniqueCode,
  normalizePaymentMethod,
} from "@/lib/payment-methods";

describe("isPaymentMethod / normalizePaymentMethod", () => {
  it("mengenali nilai kanonik persis (case-sensitive)", () => {
    expect(isPaymentMethod("MANUAL")).toBe(true);
    expect(isPaymentMethod("STENLY")).toBe(true);
    // Normalisasi huruf besar dilakukan normalizePaymentMethod, bukan di sini.
    expect(isPaymentMethod("stenly")).toBe(false);
    expect(isPaymentMethod("TRANSFER")).toBe(false);
    expect(isPaymentMethod(42)).toBe(false);
  });

  /**
   * Provider LAMA tidak boleh bisa dipilih untuk order baru: nilainya hanya
   * valid sebagai data historis di database.
   */
  it("YOBASEPAY bukan metode yang bisa dipilih untuk order baru", () => {
    expect(isPaymentMethod("YOBASEPAY")).toBe(false);
    expect(normalizePaymentMethod("YOBASEPAY", "MANUAL")).toBe("MANUAL");
  });

  it("fallback dipakai untuk nilai tak dikenal", () => {
    expect(normalizePaymentMethod(undefined, "MANUAL")).toBe("MANUAL");
    expect(normalizePaymentMethod("", "MANUAL")).toBe("MANUAL");
    expect(normalizePaymentMethod("GOPAY", "MANUAL")).toBe("MANUAL");
    expect(normalizePaymentMethod(" manual ", "STENLY")).toBe("MANUAL");
    expect(normalizePaymentMethod("stenly", "MANUAL")).toBe("STENLY");
  });
});

describe("isAutoMethod — histori transaksi tetap terbaca", () => {
  it("mengenali provider aktif maupun order arsip YoBasePay", () => {
    expect(isAutoMethod("STENLY")).toBe(true);
    expect(isAutoMethod("YOBASEPAY")).toBe(true);
    expect(isAutoMethod("MANUAL")).toBe(false);
    expect(isAutoMethod(null)).toBe(false);
  });
});

describe("manualUniqueCode", () => {
  it("selalu dalam rentang 1..999", () => {
    for (let i = 0; i < 500; i++) {
      const code = manualUniqueCode(`ORD-20260912-${String(i).padStart(6, "A")}`);
      expect(code).toBeGreaterThanOrEqual(1);
      expect(code).toBeLessThanOrEqual(999);
    }
  });

  it("deterministik untuk order yang sama (nominal tidak berubah saat reload)", () => {
    const a = manualUniqueCode("ORD-20260912-AB7K2M");
    const b = manualUniqueCode("ORD-20260912-AB7K2M");
    expect(a).toBe(b);
  });

  it("kode order berbeda menghasilkan nominal berbeda (setidaknya sebagian besar)", () => {
    const codes = new Set(
      ["ORD-20260912-AAAAAA", "ORD-20260912-AAAAAB", "ORD-20260912-AAAAAC", "ORD-20260912-AAAAAD"].map(
        (c) => manualUniqueCode(c),
      ),
    );
    expect(codes.size).toBeGreaterThan(1);
  });

  it("menghormati batas maksimum yang diminta", () => {
    expect(manualUniqueCode("ORD-20260912-AB7K2M", 99)).toBeLessThanOrEqual(99);
    expect(manualUniqueCode("ORD-20260912-AB7K2M", 0)).toBe(0);
  });
});

describe("manualChargedAmount", () => {
  it("total + kode unik, dan selalu lebih besar dari total", () => {
    const total = 85_000;
    const charged = manualChargedAmount(total, "ORD-20260912-AB7K2M");
    expect(charged).toBeGreaterThan(total);
    expect(charged).toBeLessThanOrEqual(total + 999);
    expect(charged).toBe(total + manualUniqueCode("ORD-20260912-AB7K2M"));
  });

  it("menormalkan total pecahan/negatif menjadi integer non-negatif", () => {
    expect(manualChargedAmount(1000.7, "ORD-20260912-AB7K2M")).toBe(
      1000 + manualUniqueCode("ORD-20260912-AB7K2M"),
    );
    expect(manualChargedAmount(-5, "ORD-20260912-AB7K2M")).toBe(
      manualUniqueCode("ORD-20260912-AB7K2M"),
    );
  });
});

describe("manualAmountAcceptable", () => {
  it("menerima nominal pas dan nominal + kode unik", () => {
    expect(manualAmountAcceptable(85_000, 85_000)).toBe(true);
    expect(manualAmountAcceptable(85_417, 85_000)).toBe(true);
  });
  it("menolak kekurangan bayar dan nilai tidak masuk akal", () => {
    expect(manualAmountAcceptable(84_999, 85_000)).toBe(false);
    expect(manualAmountAcceptable(Number.NaN, 85_000)).toBe(false);
  });
});

describe("isManualMethod", () => {
  it("hanya true untuk MANUAL", () => {
    expect(isManualMethod("MANUAL")).toBe(true);
    expect(isManualMethod("STENLY")).toBe(false);
    expect(isManualMethod("YOBASEPAY")).toBe(false);
    expect(isManualMethod(null)).toBe(false);
    expect(isManualMethod(undefined)).toBe(false);
  });
});
