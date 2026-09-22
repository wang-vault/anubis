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

describe("checkoutSchema", () => {
  const base = { productId: "11111111-1111-4111-8111-111111111111", quantity: 2 };

  it("menerima produk + jumlah, jumlah dikonversi dari string form", () => {
    const r = checkoutSchema.parse({ ...base, quantity: "3" });
    expect(r.productId).toBe(base.productId);
    expect(r.quantity).toBe(3);
  });

  it("TIDAK lagi menerima pilihan metode bayar dari klien (hanya satu metode)", () => {
    // Kolom metode bukan lagi bagian kontrak; nilai lama dari tab yang belum
    // di-refresh dibuang diam-diam, bukan disimpan sebagai pilihan.
    const r = checkoutSchema.parse({ ...base, ...( { paymentMethod: "STENLY" } as object) });
    expect(r).toEqual(base);
    expect(r).not.toHaveProperty("paymentMethod");
  });

  it("menolak productId bukan uuid & jumlah di luar rentang", () => {
    expect(checkoutSchema.safeParse({ ...base, productId: "produk-1" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, quantity: 21 }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, quantity: 1.5 }).success).toBe(false);
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

describe("manualSettingsSchema (WhatsApp)", () => {
  it("default masuk akal bila field opsional kosong", () => {
    const r = manualSettingsSchema.parse({ whatsapp_number: "081234567890" });
    expect(r.is_enabled).toBe(true);
    expect(r.label).toBe("Transfer Manual (WhatsApp)");
    expect(r.expiry_minutes).toBe(120);
    expect(r.account_name).toBe("");
    expect(r.whatsapp_message_template).toBe("");
  });

  it("nomor penjual WAJIB — form tanpa nomor ditolak (jangan simpan metode yang tak bisa dipakai)", () => {
    expect(manualSettingsSchema.safeParse({}).success).toBe(false);
    expect(manualSettingsSchema.safeParse({ whatsapp_number: "   " }).success).toBe(false);
    expect(
      manualSettingsSchema.safeParse({ whatsapp_number: "12345" }).success,
    ).toBe(false);
  });

  it("nomor dinormalisasi ke format 62… (spasi/tanda hubung dibuang)", () => {
    expect(manualSettingsSchema.parse({ whatsapp_number: "+62 812-3456-7890" }).whatsapp_number).toBe(
      "6281234567890",
    );
    expect(manualSettingsSchema.parse({ whatsapp_number: "0812 3456 7890" }).whatsapp_number).toBe(
      "6281234567890",
    );
  });

  it("is_enabled string false berarti mati (bukan truthy)", () => {
    const r = manualSettingsSchema.parse({ is_enabled: "false", whatsapp_number: "081234567890" });
    expect(r.is_enabled).toBe(false);
  });

  it("menolak batas waktu di luar rentang & template pesan kepanjangan", () => {
    const wa = { whatsapp_number: "081234567890" };
    expect(manualSettingsSchema.safeParse({ ...wa, expiry_minutes: 5 }).success).toBe(false);
    expect(manualSettingsSchema.safeParse({ ...wa, expiry_minutes: 99999 }).success).toBe(false);
    expect(
      manualSettingsSchema.safeParse({ ...wa, whatsapp_message_template: "x".repeat(601) }).success,
    ).toBe(false);
  });
});
