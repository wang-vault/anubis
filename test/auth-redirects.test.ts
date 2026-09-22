import { describe, expect, it } from "vitest";
import {
  GUEST_ONLY_PATHS,
  PENDING_REGISTER_COOKIE,
  PENDING_REGISTER_MAX_AGE,
  resolveAuthRedirect,
} from "@/lib/auth-redirects";

/** Helper ringkas: input default = tamu biasa tanpa penanda apa pun. */
function input(overrides: Partial<Parameters<typeof resolveAuthRedirect>[0]> = {}) {
  return {
    pathname: "/auth/login",
    nextParam: null,
    verifiedFlag: false,
    authenticated: false,
    emailVerified: false,
    pendingRegistration: false,
    ...overrides,
  };
}

describe("resolveAuthRedirect — halaman tamu (login/daftar/lupa password)", () => {
  it("tamu biasa boleh melihat semua halaman auth", () => {
    for (const p of GUEST_ONLY_PATHS) {
      expect(resolveAuthRedirect(input({ pathname: p }))).toBeNull();
    }
    expect(resolveAuthRedirect(input({ pathname: "/auth/verify" }))).toBeNull();
  });

  it("sudah login & terverifikasi → redirect keluar ke / (bukan form lagi)", () => {
    for (const p of GUEST_ONLY_PATHS) {
      expect(
        resolveAuthRedirect(input({ pathname: p, authenticated: true, emailVerified: true })),
      ).toBe("/");
    }
  });

  it("sudah login & terverifikasi → hormati ?next= yang valid", () => {
    expect(
      resolveAuthRedirect(
        input({ nextParam: "/checkout?product=123", authenticated: true, emailVerified: true }),
      ),
    ).toBe("/checkout?product=123");
  });

  it("?next= berbahaya ditolak (anti open-redirect)", () => {
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", null]) {
      expect(
        resolveAuthRedirect(input({ nextParam: bad, authenticated: true, emailVerified: true })),
      ).toBe("/");
    }
  });

  it("sudah login tapi belum verifikasi → diarahkan ke /auth/verify", () => {
    for (const p of GUEST_ONLY_PATHS) {
      expect(
        resolveAuthRedirect(input({ pathname: p, authenticated: true, emailVerified: false })),
      ).toBe("/auth/verify?unverified=1");
    }
  });
});

describe("resolveAuthRedirect — BARU MENDAFTAR (belum login, belum verifikasi)", () => {
  it("form daftar tidak ditampilkan lagi → /auth/verify", () => {
    expect(
      resolveAuthRedirect(input({ pathname: "/auth/register", pendingRegistration: true })),
    ).toBe("/auth/verify");
  });

  it("halaman masuk tetap boleh (mungkin sudah verifikasi dari perangkat lain)", () => {
    expect(
      resolveAuthRedirect(input({ pathname: "/auth/login", pendingRegistration: true })),
    ).toBeNull();
    expect(
      resolveAuthRedirect(
        input({ pathname: "/auth/forgot-password", pendingRegistration: true }),
      ),
    ).toBeNull();
  });

  it("penanda tidak berefek bila user sudah login", () => {
    expect(
      resolveAuthRedirect(
        input({
          pathname: "/auth/register",
          authenticated: true,
          emailVerified: true,
          pendingRegistration: true,
        }),
      ),
    ).toBe("/");
  });
});

describe("resolveAuthRedirect — halaman verifikasi", () => {
  it("sudah login & terverifikasi → keluar ke / (tidak perlu 'cek email')", () => {
    expect(
      resolveAuthRedirect(input({ pathname: "/auth/verify", authenticated: true, emailVerified: true })),
    ).toBe("/");
  });

  it("?verified=1 (baru sukses verifikasi via link email) tetap ditampilkan", () => {
    expect(
      resolveAuthRedirect(
        input({ pathname: "/auth/verify", authenticated: true, emailVerified: true, verifiedFlag: true }),
      ),
    ).toBeNull();
  });

  it("sudah login tapi belum verifikasi boleh tinggal di halaman verifikasi", () => {
    expect(
      resolveAuthRedirect(input({ pathname: "/auth/verify", authenticated: true, emailVerified: false })),
    ).toBeNull();
  });
});

describe("resolveAuthRedirect — admin login & rute lain", () => {
  it("sudah login di /admin/login → langsung /admin", () => {
    expect(
      resolveAuthRedirect(input({ pathname: "/admin/login", authenticated: true, emailVerified: true })),
    ).toBe("/admin");
  });

  it("rute non-auth tidak pernah ikut aturan ini", () => {
    for (const p of ["/", "/products", "/orders", "/checkout", "/pay/ORD-1", "/admin", "/auth/callback"]) {
      expect(
        resolveAuthRedirect(input({ pathname: p, authenticated: true, emailVerified: true })),
      ).toBeNull();
    }
  });
});

describe("konstanta cookie penanda pendaftaran", () => {
  it("nama & umur cookie masuk akal (umur pendek, hanya UX)", () => {
    expect(PENDING_REGISTER_COOKIE).toBe("anubis_pending_register");
    expect(PENDING_REGISTER_MAX_AGE).toBeGreaterThan(0);
    expect(PENDING_REGISTER_MAX_AGE).toBeLessThanOrEqual(60 * 60); // maks 1 jam
  });
});
