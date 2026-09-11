import { describe, expect, it } from "vitest";
import { normalizeWhatsapp, isValidWhatsapp, waMeUrl, formatWhatsappDisplay } from "@/lib/phone";

describe("normalizeWhatsapp", () => {
  it("mengubah 08xx menjadi 628xx", () => {
    expect(normalizeWhatsapp("081234567890")).toBe("6281234567890");
  });
  it("menerima format 62 langsung", () => {
    expect(normalizeWhatsapp("6281234567890")).toBe("6281234567890");
  });
  it("membersihkan karakter non-digit dan +62", () => {
    expect(normalizeWhatsapp("+62 812-3456-7890")).toBe("6281234567890");
    expect(normalizeWhatsapp("0812 3456 7890")).toBe("6281234567890");
  });
  it("menolak nomor pendek / bukan Indonesia", () => {
    expect(normalizeWhatsapp("12345")).toBeNull();
    expect(normalizeWhatsapp("99999999999")).toBeNull(); // 62 + 99... digit awal invalid
    expect(normalizeWhatsapp("")).toBeNull();
  });
  it("menolak 100 digit spam", () => {
    expect(normalizeWhatsapp("0812345678901234567890123456789")).toBeNull();
  });
  it("semua hasil normalisasi lolos isValidWhatsapp", () => {
    const v = normalizeWhatsapp("0812-3456-7890");
    expect(v).not.toBeNull();
    expect(isValidWhatsapp(v!)).toBe(true);
  });
});

describe("waMeUrl", () => {
  it("membangun link wa.me dengan pesan ter-encode", () => {
    const url = waMeUrl("6281234567890", "Halo order ORD-1");
    expect(url.startsWith("https://wa.me/6281234567890?text=Halo")).toBe(true);
    expect(url).toContain("ORD-1");
  });
});

describe("formatWhatsappDisplay", () => {
  it("menampilkan format +62 yang mudah dibaca", () => {
    expect(formatWhatsappDisplay("6281234567890")).toContain("+62");
  });
});
