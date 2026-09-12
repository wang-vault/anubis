import { describe, expect, it } from "vitest";
import { isRenderableQrSrc } from "@/lib/qr-image";

describe("isRenderableQrSrc — apa yang boleh masuk atribut src <img>", () => {
  it("menerima URL https (QR dinamis provider & QR eksternal penjual)", () => {
    expect(isRenderableQrSrc("https://yobasepay.net/qr/a.png")).toBe(true);
    expect(isRenderableQrSrc("https://cdn.toko/qris.png")).toBe(true);
  });

  it("menerima data URI gambar dari provider", () => {
    expect(isRenderableQrSrc("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isRenderableQrSrc("data:image/webp;base64,UklGR")).toBe(true);
  });

  it("menerima path same-origin (endpoint QR statis /api/manual-qr)", () => {
    expect(isRenderableQrSrc("/api/manual-qr")).toBe(true);
    expect(isRenderableQrSrc("/api/manual-qr?v=2026-09-12")).toBe(true);
  });

  it("menerima http hanya untuk pengembangan lokal", () => {
    expect(isRenderableQrSrc("http://localhost:3000/qr.png")).toBe(true);
    expect(isRenderableQrSrc("http://127.0.0.1:3000/qr.png")).toBe(true);
    expect(isRenderableQrSrc("http://yobasepay.net/qr.png")).toBe(false);
  });

  it("menolak skema berbahaya & data URI non-gambar", () => {
    expect(isRenderableQrSrc("javascript:alert(1)")).toBe(false);
    expect(isRenderableQrSrc("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isRenderableQrSrc("vbscript:msgbox(1)")).toBe(false);
  });

  it("menolak URL protocol-relative (bisa menunjuk domain lain)", () => {
    expect(isRenderableQrSrc("//evil.example/q.png")).toBe(false);
  });

  it("menolak nilai kosong / bukan string", () => {
    expect(isRenderableQrSrc(null)).toBe(false);
    expect(isRenderableQrSrc(undefined)).toBe(false);
    expect(isRenderableQrSrc("")).toBe(false);
    expect(isRenderableQrSrc("   ")).toBe(false);
  });

  it("menolak payload QRIS mentah — bukan gambar, tidak boleh dirender", () => {
    const qris =
      "00020101021226680018ID.CO.QRIS.WWW01189360091500003615350215ID2020044044351021253033605406100006304ABCD";
    expect(isRenderableQrSrc(qris)).toBe(false);
  });

  it("menolak data URI gambar yang kelewat besar", () => {
    const huge = `data:image/png;base64,${"A".repeat(2_100_000)}`;
    expect(isRenderableQrSrc(huge)).toBe(false);
  });
});
