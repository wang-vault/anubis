import { describe, expect, it } from "vitest";
import { formatRupiah } from "@/lib/money";

describe("formatRupiah", () => {
  it("memformat sesuai id-ID", () => {
    expect(formatRupiah(25000)).toBe("Rp25.000");
    expect(formatRupiah("1000000")).toBe("Rp1.000.000");
  });
  it("aman untuk nilai tak valid", () => {
    expect(formatRupiah("abc" as never)).toBe("Rp0");
  });
});
