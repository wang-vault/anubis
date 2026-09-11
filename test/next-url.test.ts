import { describe, expect, it } from "vitest";
import { parseSiteUrl, sanitizeNextPath } from "@/lib/next-url";

describe("parseSiteUrl (aman untuk metadataBase / origin)", () => {
  it("mengembalikan URL valid apa adanya", () => {
    expect(parseSiteUrl("https://toko.example.com").href).toBe(
      "https://toko.example.com/",
    );
  });
  it("trim whitespace", () => {
    expect(parseSiteUrl("  https://toko.example.com  ").origin).toBe(
      "https://toko.example.com",
    );
  });
  it("fallback saat string kosong (bug build: new URL(\"\"))", () => {
    expect(parseSiteUrl("").href).toBe("http://localhost:3000/");
    expect(parseSiteUrl(null).href).toBe("http://localhost:3000/");
    expect(parseSiteUrl(undefined).href).toBe("http://localhost:3000/");
    expect(parseSiteUrl("   ").href).toBe("http://localhost:3000/");
  });
  it("fallback saat bukan URL valid", () => {
    expect(parseSiteUrl("bukan-url").href).toBe("http://localhost:3000/");
    expect(parseSiteUrl("toko saya").href).toBe("http://localhost:3000/");
  });
  it("fallback bisa dikustomisasi", () => {
    expect(parseSiteUrl("", "https://cadangan.example.com").href).toBe(
      "https://cadangan.example.com/",
    );
  });
});

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
