import { describe, expect, it } from "vitest";
import {
  looseBooleanSchema,
  optionalHttpsUrlSchema,
  productInputSchema,
  sanitizeAdminSearchQuery,
} from "@/lib/validation";

describe("looseBooleanSchema", () => {
  it("menerima boolean murni", () => {
    expect(looseBooleanSchema.parse(true)).toBe(true);
    expect(looseBooleanSchema.parse(false)).toBe(false);
  });
  it("mem-parse string true/false dengan benar (bukan Boolean(\"false\")===true)", () => {
    expect(looseBooleanSchema.parse("false")).toBe(false);
    expect(looseBooleanSchema.parse("true")).toBe(true);
    expect(looseBooleanSchema.parse("0")).toBe(false);
    expect(looseBooleanSchema.parse("1")).toBe(true);
    expect(looseBooleanSchema.parse("off")).toBe(false);
  });
});

describe("optionalHttpsUrlSchema", () => {
  it("mengubah kosong & spasi menjadi null", () => {
    expect(optionalHttpsUrlSchema.parse("")).toBeNull();
    expect(optionalHttpsUrlSchema.parse("   ")).toBeNull();
    expect(optionalHttpsUrlSchema.parse(undefined)).toBeNull();
  });
  it("menerima https valid", () => {
    expect(optionalHttpsUrlSchema.parse("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
  });
  it("menolak http non-https", () => {
    expect(optionalHttpsUrlSchema.safeParse("http://evil.com/x").success).toBe(false);
  });
});

describe("productInputSchema is_active", () => {
  it("string \"false\" → false (bukan true)", () => {
    const r = productInputSchema.parse({
      name: "Produk A",
      description: "",
      price: 10000,
      image_url: "",
      is_active: "false",
    });
    expect(r.is_active).toBe(false);
    expect(r.image_url).toBeNull();
  });
});

describe("sanitizeAdminSearchQuery", () => {
  it("membuang metakarakter filter PostgREST", () => {
    // koma, titik, underscore, kurung dibuang/dinormalisasi agar aman di .or()
    expect(sanitizeAdminSearchQuery("test,buyer_email.eq.x")).toBe("test buyer email eq x");
    expect(sanitizeAdminSearchQuery("a),id.neq.(b")).toBe("a id neq b");
  });
  it("menolak query terlalu pendek", () => {
    expect(sanitizeAdminSearchQuery("a")).toBeNull();
    expect(sanitizeAdminSearchQuery("  ")).toBeNull();
  });
  it("mempertahankan kata kunci aman", () => {
    expect(sanitizeAdminSearchQuery("ORD-20260911")).toBe("ORD-20260911");
  });
});
