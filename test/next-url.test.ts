import { describe, expect, it } from "vitest";
import { sanitizeNextPath } from "@/lib/next-url";

describe("sanitizeNextPath (anti open-redirect)", () => {
  it("mengizinkan path relatif biasa", () => {
    expect(sanitizeNextPath("/pay/ORD-20260911-ABC123")).toBe("/pay/ORD-20260911-ABC123");
    expect(sanitizeNextPath("/checkout?product=123")).toBe("/checkout?product=123");
  });
  it("menolak protocol-relative //evil.com", () => {
    expect(sanitizeNextPath("//evil.com")).toBe("/");
  });
  it("menolak URL absolut eksternal", () => {
    expect(sanitizeNextPath("https://evil.com/x")).toBe("/");
  });
  it("menolak backslash & karakter aneh", () => {
    expect(sanitizeNextPath("/\\evil.com")).toBe("/");
    expect(sanitizeNextPath("/ok$()")).toBe("/");
  });
  it("fallback null → default", () => {
    expect(sanitizeNextPath(null, "/auth/verify")).toBe("/auth/verify");
  });
});
