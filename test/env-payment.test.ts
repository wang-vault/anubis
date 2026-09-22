/**
 * Ketahanan konfigurasi env PEMBAYARAN.
 *
 * Toko ini sudah TIDAK punya pembayaran otomatis sama sekali: satu-satunya
 * metode adalah transfer manual via WhatsApp. Yang diuji di sini:
 *
 *  - KREDENSIAL (URL & service role Supabase) → WAJIB, tetap fail-fast.
 *  - PREFERENSI (saklar manual, nomor WA cadangan) → salah ketik TIDAK BOLEH
 *    menjatuhkan aplikasi, karena serverEnv() dipanggil lewat
 *    lib/supabase/server.ts oleh HAMPIR SEMUA halaman — termasuk katalog
 *    publik & login.
 *  - Env provider lama (STENLY_*) sudah dihapus dari kode: nilainya diabaikan
 *    (tidak lagi dibaca, tidak lagi ada di Env).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CREDENTIALS = {
  NEXT_PUBLIC_SUPABASE_ACCOUNT_URL: "https://a.supabase.co",
  NEXT_PUBLIC_SUPABASE_ACCOUNT_ANON_KEY: "anonkey12345",
  SUPABASE_ACCOUNT_SERVICE_ROLE_KEY: "svc12345678",
  NEXT_PUBLIC_SUPABASE_STORE_URL: "https://b.supabase.co",
  SUPABASE_STORE_SERVICE_ROLE_KEY: "svc12345678",
};

/** Env opsional yang harus BERSIH di tiap kasus, agar nilai tidak bocor antar-pemanggilan. */
const OPTIONAL_KEYS = [
  "MANUAL_PAYMENT_ENABLED",
  "WHATSAPP_SELLER_NUMBER",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
];

/** serverEnv() meng-cache hasil → tiap kasus butuh modul yang segar. */
async function loadEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of OPTIONAL_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries({ ...CREDENTIALS, ...overrides })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("@/lib/env");
}

const ORIGINAL = { ...process.env };

beforeEach(() => {
  for (const k of Object.keys(CREDENTIALS)) delete process.env[k];
  for (const k of OPTIONAL_KEYS) delete process.env[k];
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("MANUAL_PAYMENT_ENABLED — saklar toleran", () => {
  it("mengenali bentuk truthy/falsy yang lazim", async () => {
    for (const raw of ["1", "true", "TRUE", "yes", "on"]) {
      const { serverEnv } = await loadEnv({ MANUAL_PAYMENT_ENABLED: raw });
      expect(serverEnv().MANUAL_PAYMENT_ENABLED).toBe(true);
    }
    for (const raw of ["0", "false", "no", "off", ""]) {
      const { serverEnv } = await loadEnv({ MANUAL_PAYMENT_ENABLED: raw });
      expect(serverEnv().MANUAL_PAYMENT_ENABLED).toBe(false);
    }
  });

  it("nilai tak dikenal jatuh ke default aktif, tidak melempar", async () => {
    const { serverEnv } = await loadEnv({ MANUAL_PAYMENT_ENABLED: "ya" });
    expect(() => serverEnv()).not.toThrow();
    expect(serverEnv().MANUAL_PAYMENT_ENABLED).toBe(true);
  });
});

describe("WHATSAPP_SELLER_NUMBER — cadangan nomor penjual", () => {
  it("default kosong & tidak melempar", async () => {
    const { serverEnv } = await loadEnv({});
    expect(serverEnv().WHATSAPP_SELLER_NUMBER).toBe("");
  });

  it("nilai di-trim; format apa pun diterima (validasi di normalizeWhatsapp)", async () => {
    const { serverEnv } = await loadEnv({ WHATSAPP_SELLER_NUMBER: "  0812-3456-7890  " });
    expect(serverEnv().WHATSAPP_SELLER_NUMBER).toBe("0812-3456-7890");
  });

  it("nilai tak valid tidak menjatuhkan situs (ditolak saat dipakai, bukan saat dibaca)", async () => {
    const { serverEnv } = await loadEnv({ WHATSAPP_SELLER_NUMBER: "bukan-nomor" });
    expect(() => serverEnv()).not.toThrow();
    expect(serverEnv().WHATSAPP_SELLER_NUMBER).toBe("bukan-nomor");
  });
});

describe("kredensial tetap fail-fast (jangan ikut dilonggarkan)", () => {
  it("URL/service role yang hilang atau ngawur tetap melempar", async () => {
    const cases: Record<string, string>[] = [
      { NEXT_PUBLIC_SUPABASE_STORE_URL: "" },
      { NEXT_PUBLIC_SUPABASE_STORE_URL: "bukan-url" },
      { SUPABASE_STORE_SERVICE_ROLE_KEY: "" },
      { SUPABASE_ACCOUNT_SERVICE_ROLE_KEY: "pendek" },
    ];
    for (const override of cases) {
      const { serverEnv } = await loadEnv(override);
      expect(() => serverEnv()).toThrow(/Konfigurasi environment tidak valid/);
    }
  });
});

describe("env provider lama sudah dihapus", () => {
  it("STENLY_* diabaikan: tidak ada lagi di Env & tidak berpengaruh", async () => {
    const { serverEnv } = await loadEnv({
      STENLY_API_KEY: "sk_live_masih_ada_di_vercel",
      STENLY_WEBHOOK_SECRET: "whsec_masih_ada",
      STENLY_BASE_URL: "https://stenly.id",
      STENLY_EXPIRY_MINUTES: "15",
      DEFAULT_PAYMENT_METHOD: "STENLY",
      MANUAL_PAYMENT_QR_IMAGE_URL: "https://cdn.toko/qris.png",
    });
    const env = serverEnv() as unknown as Record<string, unknown>;
    expect(env).not.toHaveProperty("STENLY_API_KEY");
    expect(env).not.toHaveProperty("STENLY_WEBHOOK_SECRET");
    expect(env).not.toHaveProperty("DEFAULT_PAYMENT_METHOD");
    expect(env).not.toHaveProperty("MANUAL_PAYMENT_QR_IMAGE_URL");
    expect(env.MANUAL_PAYMENT_ENABLED).toBe(true);
  });
});

describe("telegramConfigured", () => {
  it("butuh token DAN chat id", async () => {
    const none = await loadEnv({});
    expect(none.telegramConfigured(none.serverEnv())).toBe(false);

    const half = await loadEnv({ TELEGRAM_BOT_TOKEN: "123:abc" });
    expect(half.telegramConfigured(half.serverEnv())).toBe(false);

    const both = await loadEnv({ TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_ID: "999" });
    expect(both.telegramConfigured(both.serverEnv())).toBe(true);
  });
});
