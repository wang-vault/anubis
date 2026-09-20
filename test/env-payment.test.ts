/**
 * Ketahanan konfigurasi env PEMBAYARAN.
 *
 * Toko ini bisa dijalankan "manual saja": QRIS otomatis dimatikan dengan
 * mengosongkan kredensial Stenly. Yang diuji di sini adalah pemisahan
 * penting antara dua jenis env:
 *
 *  - KREDENSIAL (URL & service role Supabase) → WAJIB, tetap fail-fast.
 *  - PREFERENSI (metode default, saklar manual) → salah ketik TIDAK BOLEH
 *    menjatuhkan aplikasi, karena serverEnv() dipanggil lewat
 *    lib/supabase/server.ts oleh HAMPIR SEMUA halaman — termasuk katalog
 *    publik & login. Satu typo pada preferensi pembayaran dulu membuat
 *    seluruh situs balas 500, bukan cuma checkout.
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
  "DEFAULT_PAYMENT_METHOD",
  "MANUAL_PAYMENT_ENABLED",
  "STENLY_API_KEY",
  "STENLY_WEBHOOK_SECRET",
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
  delete process.env.DEFAULT_PAYMENT_METHOD;
  delete process.env.MANUAL_PAYMENT_ENABLED;
  delete process.env.STENLY_API_KEY;
  delete process.env.STENLY_WEBHOOK_SECRET;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("DEFAULT_PAYMENT_METHOD — preferensi, bukan kredensial", () => {
  it("menerima variasi kapitalisasi & spasi", async () => {
    for (const raw of ["MANUAL", "manual", "Manual", " MANUAL "]) {
      const { serverEnv } = await loadEnv({ DEFAULT_PAYMENT_METHOD: raw });
      expect(serverEnv().DEFAULT_PAYMENT_METHOD).toBe("MANUAL");
    }
    const { serverEnv } = await loadEnv({ DEFAULT_PAYMENT_METHOD: "stenly" });
    expect(serverEnv().DEFAULT_PAYMENT_METHOD).toBe("STENLY");
  });

  it("nilai tak dikenal jatuh ke MANUAL tanpa menjatuhkan aplikasi", async () => {
    const { serverEnv } = await loadEnv({ DEFAULT_PAYMENT_METHOD: "ngaco" });
    expect(() => serverEnv()).not.toThrow();
    expect(serverEnv().DEFAULT_PAYMENT_METHOD).toBe("MANUAL");
  });
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

describe("mode manual-saja", () => {
  it("Stenly nonaktif selama kredensialnya kosong", async () => {
    const { serverEnv, stenlyConfigured } = await loadEnv({});
    expect(stenlyConfigured(serverEnv())).toBe(false);
  });

  it("butuh secret key DAN webhook secret — setengah terisi tetap nonaktif", async () => {
    const onlyKey = await loadEnv({ STENLY_API_KEY: "sk_live_123" });
    expect(onlyKey.stenlyConfigured(onlyKey.serverEnv())).toBe(false);

    const onlySecret = await loadEnv({ STENLY_WEBHOOK_SECRET: "whsec_123" });
    expect(onlySecret.stenlyConfigured(onlySecret.serverEnv())).toBe(false);

    const both = await loadEnv({
      STENLY_API_KEY: "sk_live_123",
      STENLY_WEBHOOK_SECRET: "whsec_123",
    });
    expect(both.stenlyConfigured(both.serverEnv())).toBe(true);
  });

  it("mengenali key sandbox lewat prefix sk_test_", async () => {
    const live = await loadEnv({
      STENLY_API_KEY: "sk_live_abc",
      STENLY_WEBHOOK_SECRET: "whsec_1",
    });
    expect(live.stenlyIsSandbox(live.serverEnv())).toBe(false);

    const sandbox = await loadEnv({
      STENLY_API_KEY: "sk_test_abc",
      STENLY_WEBHOOK_SECRET: "whsec_1",
    });
    expect(sandbox.stenlyIsSandbox(sandbox.serverEnv())).toBe(true);
  });
});

describe("kompatibilitas env lama", () => {
  /**
   * Deployment yang belum memperbarui env masih memakai
   * DEFAULT_PAYMENT_METHOD=YOBASEPAY. Nilai itu harus tetap berarti "QRIS
   * otomatis" (kini Stenly) — bukan diam-diam berpindah ke MANUAL.
   */
  it("DEFAULT_PAYMENT_METHOD=YOBASEPAY tetap diartikan QRIS otomatis", async () => {
    const { serverEnv } = await loadEnv({ DEFAULT_PAYMENT_METHOD: "YOBASEPAY" });
    expect(serverEnv().DEFAULT_PAYMENT_METHOD).toBe("STENLY");
  });
});
