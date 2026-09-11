import { describe, expect, it } from "vitest";
import {
  checkoutSchema,
  looseBooleanSchema,
  manualClaimSchema,
  manualSettingsSchema,
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

describe("checkoutSchema.paymentMethod", () => {
  const base = { productId: "11111111-1111-4111-8111-111111111111", quantity: 2 };

  it("opsional — tidak diisi tetap valid (server yang memilih default)", () => {
    const r = checkoutSchema.parse(base);
    expect(r.paymentMethod).toBeUndefined();
  });
  it("meneruskan nilai mentah apa adanya untuk diputuskan server", () => {
    expect(checkoutSchema.parse({ ...base, paymentMethod: "MANUAL" }).paymentMethod).toBe("MANUAL");
    // Nilai ngawur dari klien TIDAK ditolak di sini — ditolak resolvePaymentMethod.
    expect(checkoutSchema.parse({ ...base, paymentMethod: "GOPAY" }).paymentMethod).toBe("GOPAY");
  });
});

describe("manualClaimSchema", () => {
  it("menerima klaim lengkap dan menormalkan spasi", () => {
    const r = manualClaimSchema.parse({
      orderCode: "ORD-20260912-AB7K2M",
      note: "  Budi Santoso  ",
      reference: " 12345 ",
    });
    expect(r.note).toBe("Budi Santoso");
    expect(r.reference).toBe("12345");
  });
  it("catatan & referensi opsional (default kosong)", () => {
    const r = manualClaimSchema.parse({ orderCode: "ORD-20260912-AB7K2M" });
    expect(r.note).toBe("");
    expect(r.reference).toBe("");
  });
  it("menolak kode order tak valid & catatan terlalu panjang", () => {
    expect(manualClaimSchema.safeParse({ orderCode: "ORD-123" }).success).toBe(false);
    expect(manualClaimSchema.safeParse({ orderCode: "ORD-20260912-AB7K2M", note: "x".repeat(201) }).success).toBe(false);
  });
});

describe("manualSettingsSchema", () => {
  it("default masuk akal bila field kosong", () => {
    const r = manualSettingsSchema.parse({});
    expect(r.is_enabled).toBe(true);
    expect(r.label).toBe("Transfer Manual (QRIS)");
    expect(r.expiry_minutes).toBe(120);
  });
  it("is_enabled string false berarti mati (bukan truthy)", () => {
    expect(manualSettingsSchema.parse({ is_enabled: "false" }).is_enabled).toBe(false);
  });
  it("menolak batas waktu di luar rentang", () => {
    expect(manualSettingsSchema.safeParse({ expiry_minutes: 5 }).success).toBe(false);
    expect(manualSettingsSchema.safeParse({ expiry_minutes: 99999 }).success).toBe(false);
  });
});
