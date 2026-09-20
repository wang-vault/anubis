/**
 * Normalisasi respons Stenly — modul murni (tanpa I/O).
 *
 * Nama field & nilai status di sini diambil PERSIS dari dokumentasi resmi
 * https://stenly.id/docs (§Create Charge, §Siklus Status Transaksi, §Webhook).
 */
import { describe, expect, it } from "vitest";
import {
  STENLY_AMOUNT_KEYS,
  STENLY_EXPIRY_KEYS,
  STENLY_ORDER_ID_KEYS,
  STENLY_PAYMENT_URL_KEYS,
  asNumber,
  asString,
  isQrisPayload,
  mapStenlyStatus,
  parseProviderDate,
  pickNumber,
  pickString,
  sanitizeProviderUrl,
} from "@/lib/integrations/payment/normalize";

describe("asString / asNumber", () => {
  it("string kosong & hanya spasi dianggap tidak ada", () => {
    expect(asString("")).toBeNull();
    expect(asString("   ")).toBeNull();
    expect(asString(42)).toBeNull();
    expect(asString(" INV-1 ")).toBe("INV-1");
  });

  it("angka diterima dari number maupun string (termasuk berisi pemisah)", () => {
    expect(asNumber(50000)).toBe(50000);
    expect(asNumber("50000")).toBe(50000);
    expect(asNumber("Rp10.500")).toBe(10500);
    expect(asNumber("")).toBeNull();
    expect(asNumber("abc")).toBeNull();
    expect(asNumber(Number.NaN)).toBeNull();
  });

  /**
   * REGRESI (uang): parser sempat membuang SEMUA non-digit, sehingga nominal
   * berdesimal "10500.00" (bentuk lazim untuk kolom DECIMAL) dibaca 1050000 —
   * 100× lipat. Akibatnya charged_amount salah di halaman bayar DAN webhook
   * pembayaran yang sah ditolak `amount_mismatch` → order tidak pernah PAID.
   */
  it("nominal berdesimal tidak boleh terbaca 100x lipat", () => {
    expect(asNumber("10500.00")).toBe(10500);
    expect(asNumber("10500,00")).toBe(10500);
    expect(asNumber("10,500.00")).toBe(10500);
    expect(asNumber("10.500,00")).toBe(10500);
  });

  it("membedakan pemisah ribuan (3 digit) dari desimal (1-2 digit)", () => {
    expect(asNumber("1.234.567")).toBe(1234567);
    expect(asNumber("1,234,567.89")).toBe(1234568);
    expect(asNumber("10 500")).toBe(10500);
  });

  it("Rupiah tidak memakai sen — hasil selalu integer", () => {
    expect(asNumber("10500.50")).toBe(10501);
    expect(asNumber(10500.4)).toBe(10500);
  });

  it("nilai tanpa digit tetap ditolak", () => {
    expect(asNumber("-")).toBeNull();
    expect(asNumber(".")).toBeNull();
    expect(asNumber("Rp")).toBeNull();
  });
});

describe("pickString / pickNumber terhadap respons charge Stenly", () => {
  /** Contoh response 201 dari dokumentasi resmi (§Create Charge). */
  const CHARGE_RESPONSE = {
    order_id: "INV-20260829-01",
    project_slug: "tokotopup",
    gross_amount: 50000,
    currency: "IDR",
    status: "pending",
    payment_method: "qris",
    qr_string: "00020101021226670016ID.STENLY.WWW01189360091800000000000215INV-20260829-01",
    qr_image_url: "/api/v1/qr/INV-20260829-01?api_key=sk_live_secret",
    payment_url: "https://stenly.id/pay/INV-20260829-01",
    expires_at: "2026-08-29T07:20:00.000Z",
    created_at: "2026-08-29T07:05:00.000Z",
  };

  it("mengambil order_id, gross_amount, payment_url & expires_at", () => {
    expect(pickString(CHARGE_RESPONSE, STENLY_ORDER_ID_KEYS)?.value).toBe("INV-20260829-01");
    expect(pickNumber(CHARGE_RESPONSE, STENLY_AMOUNT_KEYS)?.value).toBe(50000);
    expect(pickString(CHARGE_RESPONSE, STENLY_PAYMENT_URL_KEYS)?.value).toBe(
      "https://stenly.id/pay/INV-20260829-01",
    );
    expect(pickString(CHARGE_RESPONSE, STENLY_EXPIRY_KEYS)?.value).toBe(
      "2026-08-29T07:20:00.000Z",
    );
  });

  it("field yang tidak ada → null (bukan menebak field lain)", () => {
    expect(pickString({}, STENLY_ORDER_ID_KEYS)).toBeNull();
    expect(pickNumber({ amount: 50000 }, STENLY_AMOUNT_KEYS)).toBeNull();
  });
});

describe("sanitizeProviderUrl — kredensial tidak boleh bocor ke browser", () => {
  /**
   * KEAMANAN: dokumentasi Stenly menunjukkan URL yang membawa API key pada
   * query string. Nilai itu berakhir di halaman pembayaran buyer, jadi
   * parameter rahasia WAJIB dibuang sebelum disimpan/dirender.
   */
  it("membuang api_key & parameter rahasia lain", () => {
    const res = sanitizeProviderUrl("https://stenly.id/pay/INV-1?api_key=sk_live_rahasia&x=1");
    expect(res.hadSecret).toBe(true);
    expect(res.url).toBe("https://stenly.id/pay/INV-1?x=1");
    expect(res.url).not.toContain("sk_live_rahasia");
  });

  it("URL bersih dibiarkan apa adanya", () => {
    const res = sanitizeProviderUrl("https://stenly.id/pay/INV-1");
    expect(res.hadSecret).toBe(false);
    expect(res.url).toBe("https://stenly.id/pay/INV-1");
  });

  it("http dinaikkan ke https (hindari mixed content), localhost dikecualikan", () => {
    expect(sanitizeProviderUrl("http://stenly.id/pay/1").url).toBe("https://stenly.id/pay/1");
    expect(sanitizeProviderUrl("http://localhost:3000/pay/1").url).toBe(
      "http://localhost:3000/pay/1",
    );
  });

  it("skema berbahaya & nilai tak valid → null", () => {
    expect(sanitizeProviderUrl("javascript:alert(1)").url).toBeNull();
    expect(sanitizeProviderUrl("data:text/html;base64,PHNjcmlwdD4=").url).toBeNull();
    expect(sanitizeProviderUrl("bukan url").url).toBeNull();
    expect(sanitizeProviderUrl(null).url).toBeNull();
  });
});

describe("isQrisPayload", () => {
  const QRIS =
    "00020101021226670016ID.STENLY.WWW01189360091800000000000215INV-20260829-015204581253033605405500005802ID6304ABCD";

  it("menerima payload EMVCo yang diawali 0002", () => {
    expect(isQrisPayload(QRIS)).toBe(true);
  });

  it("menolak URL, HTML, string pendek, dan nilai bukan-QRIS", () => {
    expect(isQrisPayload("https://stenly.id/qr/INV-1")).toBe(false);
    expect(isQrisPayload("<script>alert(1)</script>")).toBe(false);
    expect(isQrisPayload("0002")).toBe(false);
    expect(isQrisPayload("")).toBe(false);
    expect(isQrisPayload(null)).toBe(false);
  });
});

describe("mapStenlyStatus — hanya status yang ada di dokumentasi", () => {
  it("status production dipetakan sesuai dokumentasi", () => {
    expect(mapStenlyStatus("pending")).toBe("pending");
    expect(mapStenlyStatus("paid")).toBe("paid");
    expect(mapStenlyStatus("expired")).toBe("expired");
    expect(mapStenlyStatus("cancelled")).toBe("failed");
  });

  it("status sandbox (sandbox_trx_*) dipetakan sama seperti production", () => {
    expect(mapStenlyStatus("sandbox_trx_pending")).toBe("pending");
    expect(mapStenlyStatus("sandbox_trx_paid")).toBe("paid");
    expect(mapStenlyStatus("sandbox_trx_expired")).toBe("expired");
    expect(mapStenlyStatus("sandbox_trx_cancelled")).toBe("failed");
  });

  /**
   * Docs: "paid_after_expiry = bayar sebelum expired yang terdeteksi telat.
   * Perlakukan sama seperti paid."
   */
  it("paid_after_expiry diperlakukan sebagai LUNAS", () => {
    expect(mapStenlyStatus("paid_after_expiry")).toBe("paid");
  });

  it("kapitalisasi & spasi ditoleransi", () => {
    expect(mapStenlyStatus(" PAID ")).toBe("paid");
    expect(mapStenlyStatus("Pending")).toBe("pending");
  });

  it("status di luar dokumentasi → unknown (tidak mengubah order)", () => {
    expect(mapStenlyStatus("settlement")).toBe("unknown");
    expect(mapStenlyStatus("success")).toBe("unknown");
    expect(mapStenlyStatus("APA-INI")).toBe("unknown");
    expect(mapStenlyStatus(null)).toBe("unknown");
  });
});

describe("parseProviderDate", () => {
  it("ISO 8601 UTC dari Stenly dipakai apa adanya", () => {
    expect(parseProviderDate("2026-08-29T07:20:00.000Z")).toBe("2026-08-29T07:20:00.000Z");
  });

  it("datetime tanpa zona dianggap WIB (jaring pengaman)", () => {
    expect(parseProviderDate("2026-01-01 12:00:00")).toBe("2026-01-01T05:00:00.000Z");
  });

  it("nilai tak dikenal → null (bukan tanggal salah)", () => {
    expect(parseProviderDate("besok siang")).toBeNull();
    expect(parseProviderDate(null)).toBeNull();
  });
});
