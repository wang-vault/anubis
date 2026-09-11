import { describe, expect, it } from "vitest";
import { generateOrderCode, ORDER_CODE_REGEX } from "@/lib/order-code";

describe("generateOrderCode", () => {
  it("cocok dengan pola ORD-YYYYMMDD-XXXXXX (tanggal WIB)", () => {
    // 04:00 UTC = 11:00 WIB → 11 Sep 2026
    const code = generateOrderCode(new Date("2026-09-11T04:00:00Z"));
    expect(code).toMatch(/^ORD-20260911-[A-Z0-9]{6}$/);
    expect(code).toMatch(ORDER_CODE_REGEX);
  });
  it("memakai tanggal WIB di dini hari (UTC masih kemarin)", () => {
    // 2026-09-10 20:00 UTC = 2026-09-11 03:00 WIB → harus 11 Sep, bukan 10
    const code = generateOrderCode(new Date("2026-09-10T20:00:00Z"));
    expect(code).toMatch(/^ORD-20260911-[A-Z0-9]{6}$/);
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
