import { describe, expect, it } from "vitest";
import { amountWithinTolerance, formatRupiah } from "@/lib/money";

describe("amountWithinTolerance", () => {
  const total = 25000;
  it("menerima nominal pas", () => {
    expect(amountWithinTolerance(25000, total, 999)).toBe(true);
  });
  it("menerima nominal + kode unik 1..999", () => {
    expect(amountWithinTolerance(25042, total, 999)).toBe(true);
    expect(amountWithinTolerance(25999, total, 999)).toBe(true);
  });
  it("menolak nominal kurang dari total", () => {
    expect(amountWithinTolerance(24999, total, 999)).toBe(false);
  });
  it("menolak nominal lebih dari total + toleransi", () => {
    expect(amountWithinTolerance(26000, total, 999)).toBe(false);
  });
  it("toleransi 0 (V3 no-unique-code) hanya menerima nominal pas", () => {
    expect(amountWithinTolerance(25000, total, 0)).toBe(true);
    expect(amountWithinTolerance(25001, total, 0)).toBe(false);
  });
  it("menolak NaN", () => {
    expect(amountWithinTolerance(Number.NaN, total, 999)).toBe(false);
  });
});

describe("formatRupiah", () => {
  it("memformat sesuai id-ID", () => {
    expect(formatRupiah(25000)).toBe("Rp25.000");
    expect(formatRupiah("1000000")).toBe("Rp1.000.000");
  });
  it("aman untuk nilai tak valid", () => {
    expect(formatRupiah("abc" as never)).toBe("Rp0");
  });
});
