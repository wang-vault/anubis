import { describe, expect, it } from "vitest";
import {
  AMOUNT_KEYS,
  EXPIRY_KEYS,
  PAYMENT_URL_KEYS,
  TRX_ID_KEYS,
  asNumber,
  asString,
  base64ToDataUri,
  classifyQrValue,
  extractQr,
  mapStatus,
  parseProviderDate,
  pickNumber,
  pickString,
  renderPayloadToUrl,
  resolveProviderUrl,
} from "@/lib/integrations/payment/normalize";

const BASE = "https://yobasepay.net/api";

describe("asString / asNumber", () => {
  it("string kosong & hanya spasi dianggap tidak ada", () => {
    expect(asString("")).toBeNull();
    expect(asString("   ")).toBeNull();
    expect(asString(42)).toBeNull();
    expect(asString(" YO-1 ")).toBe("YO-1");
  });

  it("angka diterima dari number maupun string (termasuk berisi pemisah)", () => {
    expect(asNumber(10500)).toBe(10500);
    expect(asNumber("10500")).toBe(10500);
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
    expect(asNumber("0.99")).toBe(1);
  });

  it("nilai tanpa digit tetap ditolak", () => {
    expect(asNumber("-")).toBeNull();
    expect(asNumber(".")).toBeNull();
    expect(asNumber("Rp")).toBeNull();
  });
});

describe("pickString / pickNumber (prioritas nama field)", () => {
  it("memakai kandidat pertama yang terisi", () => {
    expect(pickString({ trxid: "YO-B", trx_id: "YO-A" }, TRX_ID_KEYS)?.value).toBe("YO-A");
    expect(pickString({ trxid: "YO-B" }, TRX_ID_KEYS)?.value).toBe("YO-B");
    expect(pickString({ id: "X-1" }, TRX_ID_KEYS)?.value).toBe("X-1");
    expect(pickString({}, TRX_ID_KEYS)).toBeNull();
  });

  it("amount jatuh ke varian lain bila field utama tidak ada", () => {
    expect(pickNumber({ amount: 10500 }, AMOUNT_KEYS)?.value).toBe(10500);
    expect(pickNumber({ receive_amount: "10500" }, AMOUNT_KEYS)?.value).toBe(10500);
    expect(pickNumber({ nominal: 10500 }, AMOUNT_KEYS)?.value).toBe(10500);
  });

  it("payment_url & expired_at punya varian yang dikenali", () => {
    expect(pickString({ pay_url: "https://x/pay/1" }, PAYMENT_URL_KEYS)?.value).toBe(
      "https://x/pay/1",
    );
    expect(pickString({ expiry: "2026-01-01 12:00:00" }, EXPIRY_KEYS)?.value).toBe(
      "2026-01-01 12:00:00",
    );
  });
});

describe("resolveProviderUrl", () => {
  it("URL https absolut dipakai apa adanya", () => {
    expect(resolveProviderUrl("https://yobasepay.net/qr/a.png", BASE)).toBe(
      "https://yobasepay.net/qr/a.png",
    );
  });

  it("http dinaikkan ke https kecuali localhost (mixed content)", () => {
    expect(resolveProviderUrl("http://yobasepay.net/qr/a.png", BASE)).toBe(
      "https://yobasepay.net/qr/a.png",
    );
    expect(resolveProviderUrl("http://localhost:3000/qr/a.png", BASE)).toBe(
      "http://localhost:3000/qr/a.png",
    );
  });

  it("protocol-relative diberi skema https", () => {
    expect(resolveProviderUrl("//yobasepay.net/qr/a.png", BASE)).toBe(
      "https://yobasepay.net/qr/a.png",
    );
  });

  it("path relatif di-resolve terhadap origin provider", () => {
    expect(resolveProviderUrl("/assets/uploads/qr/a.png", BASE)).toBe(
      "https://yobasepay.net/assets/uploads/qr/a.png",
    );
    expect(resolveProviderUrl("qr/a.png", BASE)).toBe("https://yobasepay.net/qr/a.png");
  });

  it("skema berbahaya & data URI ditolak di sini", () => {
    expect(resolveProviderUrl("javascript:alert(1)", BASE)).toBeNull();
    expect(resolveProviderUrl("data:image/png;base64,AAAA", BASE)).toBeNull();
    expect(resolveProviderUrl("", BASE)).toBeNull();
  });

  /**
   * REGRESI (keamanan): "\" setara "/" pada URL ber-skema khusus menurut
   * WHATWG, jadi "/\evil.id/qr.png" BUKAN path — ia di-resolve menjadi
   * https://evil.id/qr.png, keluar dari origin provider. Nilai ini datang
   * dari respons provider dan berakhir di atribut src <img> halaman bayar,
   * jadi hasilnya harus tetap berada di origin provider.
   */
  it("path yang memuat backslash tidak boleh keluar dari origin provider", () => {
    for (const value of ["/\\evil.id/qr.png", "/\\\\evil.id/qr.png", "\\/evil.id/qr.png"]) {
      const resolved = resolveProviderUrl(value, BASE);
      if (resolved !== null) {
        expect(new URL(resolved).origin).toBe("https://yobasepay.net");
      }
    }
  });
});

describe("classifyQrValue", () => {
  it("mengenali URL gambar, termasuk path relatif berekstensi", () => {
    expect(classifyQrValue("https://x/a.png")).toBe("image-url");
    expect(classifyQrValue("//x/a.png")).toBe("image-url");
    expect(classifyQrValue("/assets/qr/a.png")).toBe("image-url");
    expect(classifyQrValue("qr/a.webp")).toBe("image-url");
  });

  it("mengenali data URI gambar dan menolak data URI non-gambar", () => {
    expect(classifyQrValue("data:image/png;base64,iVBORw0KGgo=")).toBe("data-uri");
    expect(classifyQrValue("data:text/html;base64,PHNjcmlwdD4=")).toBe("unknown");
  });

  it("mengenali payload QRIS (EMVCo) — diawali 00, charset TLV", () => {
    const qris =
      "00020101021226680018ID.CO.QRIS.WWW01189360091500003615350215ID2020044044351021253033605406100006304ABCD";
    expect(classifyQrValue(qris)).toBe("emvco-payload");
  });

  it("mengenali blob base64 tanpa prefix data:", () => {
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB".repeat(4);
    expect(classifyQrValue(b64)).toBe("base64-image");
  });

  it("path provider tanpa ekstensi tetap dianggap URL gambar", () => {
    expect(classifyQrValue("/qr/ABC123")).toBe("image-url");
    expect(extractQr({ qr_image: "/qr/ABC123" }, BASE).imageUrl).toBe(
      "https://yobasepay.net/qr/ABC123",
    );
  });

  it("teks bebas tidak dianggap path (tidak jadi URL ngawur)", () => {
    expect(classifyQrValue("halo dunia")).toBe("unknown");
    expect(extractQr({ qr_image: "silakan scan qr ini" }, BASE).imageUrl).toBeNull();
  });

  it("nilai tak dikenal → unknown (UI fallback ke tombol pembayaran)", () => {
    expect(classifyQrValue("")).toBe("unknown");
    expect(classifyQrValue("halo dunia")).toBe("unknown");
  });
});

describe("base64ToDataUri", () => {
  it("membungkus base64 jadi data URI, mime tak dikenal → png", () => {
    expect(base64ToDataUri("iVBORw0KGgo=", "image/webp")).toBe("data:image/webp;base64,iVBORw0KGgo=");
    expect(base64ToDataUri("iVBORw0KGgo=", "text/html")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(base64ToDataUri("bukan base64!!")).toBeNull();
  });
});

describe("extractQr — varian respons provider", () => {
  it("dokumentasi lama: qr_image URL absolut", () => {
    const qr = extractQr({ qr_image: "https://yobasepay.net/qr/a.png" }, BASE);
    expect(qr.imageUrl).toBe("https://yobasepay.net/qr/a.png");
    expect(qr.fieldUsed).toBe("qr_image");
    expect(qr.payload).toBeNull();
  });

  it("varian nama field lain tetap dikenali", () => {
    expect(extractQr({ qris_url: "https://x/q.png" }, BASE).imageUrl).toBe("https://x/q.png");
    expect(extractQr({ qr_image_url: "https://x/q.png" }, BASE).imageUrl).toBe("https://x/q.png");
    expect(extractQr({ qr_code_url: "https://x/q.png" }, BASE).imageUrl).toBe("https://x/q.png");
  });

  it("URL relatif & protocol-relative dinormalisasi jadi absolut", () => {
    expect(extractQr({ qr_image: "/uploads/qr/a.png" }, BASE).imageUrl).toBe(
      "https://yobasepay.net/uploads/qr/a.png",
    );
    expect(extractQr({ qr_image: "//yobasepay.net/uploads/a.png" }, BASE).imageUrl).toBe(
      "https://yobasepay.net/uploads/a.png",
    );
  });

  it("base64 (dengan dan tanpa prefix) jadi data URI siap render", () => {
    const withPrefix = extractQr({ qr_image: "data:image/png;base64,iVBORw0KGgo=" }, BASE);
    expect(withPrefix.imageUrl).toBe("data:image/png;base64,iVBORw0KGgo=");

    const blob = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB".repeat(4);
    const noPrefix = extractQr({ qr_image_base64: blob }, BASE);
    expect(noPrefix.imageUrl?.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("hanya payload QRIS → imageUrl null, payload tersimpan utk diagnostik", () => {
    const qris =
      "00020101021226680018ID.CO.QRIS.WWW01189360091500003615350215ID2020044044351021253033605406100006304ABCD";
    const qr = extractQr({ qr_string: qris }, BASE);
    expect(qr.imageUrl).toBeNull();
    expect(qr.payload).toBe(qris);
    expect(qr.fieldUsed).toBe("qr_string");
  });

  it("gambar menang atas payload bila dua-duanya dikirim", () => {
    const qr = extractQr(
      { qr_string: "00020101021226680018ID.CO.QRIS.WWW01189360091500003615", qr_image: "https://x/q.png" },
      BASE,
    );
    expect(qr.imageUrl).toBe("https://x/q.png");
    expect(qr.payload).toBeNull();
  });

  it("tidak ada field QR sama sekali → null semua (bukan throw)", () => {
    expect(extractQr({ trx_id: "YO-1" }, BASE)).toEqual({
      imageUrl: null,
      payload: null,
      fieldUsed: null,
      kind: null,
    });
  });
});

describe("renderPayloadToUrl", () => {
  const TEMPLATE = "https://api.qrserver.com/v1/create-qr-code/?size=320x320&data={payload}";

  it("meng-URL-encode payload ke dalam template https", () => {
    const url = renderPayloadToUrl("000201010212266800*18ID.CO", TEMPLATE);
    expect(url).toContain("https://api.qrserver.com/v1/create-qr-code/");
    expect(url).toContain(encodeURIComponent("000201010212266800*18ID.CO"));
  });

  it("menolak template tanpa placeholder, non-https, atau kosong", () => {
    expect(renderPayloadToUrl("0002", "https://x/qr.png")).toBeNull();
    expect(renderPayloadToUrl("0002", "http://x/qr?d={payload}")).toBeNull();
    expect(renderPayloadToUrl("0002", null)).toBeNull();
    expect(renderPayloadToUrl("", TEMPLATE)).toBeNull();
  });
});

describe("mapStatus", () => {
  it("varian status provider dipetakan ke state internal", () => {
    expect(mapStatus("SUCCESS")).toBe("paid");
    expect(mapStatus("settlement")).toBe("unknown");
    expect(mapStatus("SETTLED")).toBe("paid");
    expect(mapStatus("LUNAS")).toBe("paid");
    expect(mapStatus("EXPIRED")).toBe("expired");
    expect(mapStatus("CANCELLED")).toBe("failed");
    expect(mapStatus("WAITING_PAYMENT")).toBe("pending");
    expect(mapStatus(" pending ")).toBe("pending");
    expect(mapStatus(null)).toBe("unknown");
    expect(mapStatus("APA-INI")).toBe("unknown");
  });
});

describe("parseProviderDate", () => {
  it("datetime tanpa zona dianggap memakai offset yang dikonfigurasi", () => {
    expect(parseProviderDate("2026-01-01 12:00:00", "+07:00")).toBe(
      "2026-01-01T05:00:00.000Z",
    );
  });

  it("string yang sudah berzona tidak ditimpa", () => {
    expect(parseProviderDate("2026-01-01T12:00:00Z", "+07:00")).toBe(
      "2026-01-01T12:00:00.000Z",
    );
    expect(parseProviderDate("2026-01-01T12:00:00+07:00", "+00:00")).toBe(
      "2026-01-01T05:00:00.000Z",
    );
  });

  it("nilai tak dikenal → null (bukan tanggal salah)", () => {
    expect(parseProviderDate("besok siang", "+07:00")).toBeNull();
    expect(parseProviderDate(null, "+07:00")).toBeNull();
  });
});
