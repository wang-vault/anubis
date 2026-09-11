import { describe, expect, it } from "vitest";
import { generateOrderCode, ORDER_CODE_REGEX } from "@/lib/order-code";

describe("generateOrderCode", () => {
  it("cocok dengan pola ORD-YYYYMMDD-XXXXXX", () => {
    const code = generateOrderCode(new Date("2026-09-11T04:00:00Z"));
    expect(code).toMatch(/^ORD-20260911-[A-Z0-9]{6}$/);
    expect(code).toMatch(ORDER_CODE_REGEX);
  });
  it("tidak memakai karakter yang mudah tertukar (0,O,1,I,L)", () => {
    for (let i = 0; i < 300; i++) {
      const parts = generateOrderCode().split("-");
      const suffix = parts[2] ?? "";
      expect(suffix.length).toBe(6);
      expect(suffix).not.toMatch(/[01ILO]/);
    }
  });
  it("unik untuk 5000 generate beruntun (probabilistik; tabrakan praktis ~0)", () => {
    const set = new Set<string>();
    for (let i = 0; i < 5000; i++) set.add(generateOrderCode());
    expect(set.size).toBeGreaterThan(4980); // toleransi kecil tabrakan 628^... 
  });
});

describe("ORDER_CODE_REGEX", () => {
  it("menolak format lain (anti injeksi)", () => {
    expect(ORDER_CODE_REGEX.test("ORD-2026091-ABC123")).toBe(false);
    expect(ORDER_CODE_REGEX.test("'; DROP TABLE orders;--")).toBe(false);
    expect(ORDER_CODE_REGEX.test("ORD-20260911-ABC1234")).toBe(false);
  });
});
