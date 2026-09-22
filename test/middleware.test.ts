import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit test middleware dengan @supabase/ssr di-mock penuh:
 * - getUserMock mengontrol "ada user / tidak".
 * - Mock memanggil cookies.setAll(...) untuk mensimulasikan ROTASI token oleh
 *   getUser() — memastikan redirect tetap MEMBAWA cookie session yang baru
 *   (bug lama: redirect polos membuang cookie → user login terlihat logout).
 */

let mockUser: Record<string, unknown> | null = null;
let rotateSession = false;

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(
    (
      _url: string,
      _key: string,
      opts: {
        cookies: {
          setAll: (c: { name: string; value: string; options?: Record<string, unknown> }[]) => void;
        };
      },
    ) => ({
      auth: {
        getUser: async () => {
          if (rotateSession) {
            opts.cookies.setAll([
              { name: "sb-account-refresh-token", value: "baru-terrotasi", options: { path: "/" } },
            ]);
          }
          return { data: { user: mockUser } };
        },
      },
    }),
  ),
}));

process.env.NEXT_PUBLIC_SUPABASE_ACCOUNT_URL ??= "https://akun.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ACCOUNT_ANON_KEY ??= "anon-key-testing";

const { middleware } = await import("@/middleware");
const { NextRequest } = await import("next/server");

function makeRequest(
  path: string,
  cookies: Record<string, string> = {},
): InstanceType<typeof NextRequest> {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

const verifiedUser = { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" };
const unverifiedUser = { id: "u2", email_confirmed_at: null, confirmed_at: null };

beforeEach(() => {
  mockUser = null;
  rotateSession = false;
});

describe("middleware — halaman auth khusus tamu", () => {
  it("tamu biasa: /auth/login & /auth/register & /auth/forgot-password lolos", async () => {
    for (const p of ["/auth/login", "/auth/register", "/auth/forgot-password", "/auth/verify"]) {
      const res = await middleware(makeRequest(p));
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.status).toBe(200);
    }
  });

  it("sudah login (terverifikasi): /auth/register → redirect ke /", async () => {
    mockUser = verifiedUser;
    const res = await middleware(makeRequest("/auth/register"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!, "http://localhost:3000").pathname).toBe("/");
  });

  it("sudah login (terverifikasi): /auth/login?next=/checkout → ke /checkout", async () => {
    mockUser = verifiedUser;
    const res = await middleware(makeRequest("/auth/login?next=/checkout"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/checkout");
  });

  it("sudah login tapi belum verifikasi: /auth/register → /auth/verify?unverified=1", async () => {
    mockUser = unverifiedUser;
    const res = await middleware(makeRequest("/auth/register"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/auth/verify?unverified=1");
  });

  it("BARU daftar (cookie penanda, belum login): /auth/register → /auth/verify", async () => {
    const res = await middleware(
      makeRequest("/auth/register", { anubis_pending_register: "1" }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/auth/verify");
  });

  it("BARU daftar: /auth/login tetap boleh (verifikasi mungkin dari perangkat lain)", async () => {
    const res = await middleware(
      makeRequest("/auth/login", { anubis_pending_register: "1" }),
    );
    expect(res.status).toBe(200);
  });

  it("sudah login & terverifikasi: /auth/verify → / , tapi ?verified=1 tetap tampil", async () => {
    mockUser = verifiedUser;
    expect((await middleware(makeRequest("/auth/verify"))).headers.get("location")).toBe(
      "http://localhost:3000/",
    );
    expect((await middleware(makeRequest("/auth/verify?verified=1"))).status).toBe(200);
  });
});

describe("middleware — area terlindungi (perilaku lama tetap)", () => {
  it("tamu ke /orders → login dengan ?next=", async () => {
    const res = await middleware(makeRequest("/orders"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/auth/login?next=%2Forders",
    );
  });

  it("tamu ke /admin → /admin/login", async () => {
    const res = await middleware(makeRequest("/admin"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/admin/login?next=%2Fadmin");
  });

  it("sudah login: /admin/login → /admin", async () => {
    mockUser = verifiedUser;
    const res = await middleware(makeRequest("/admin/login"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/admin");
  });

  it("sudah login: area pembeli & admin lolos middleware", async () => {
    mockUser = verifiedUser;
    for (const p of ["/orders", "/checkout", "/pay/ORD-1", "/admin"]) {
      expect((await middleware(makeRequest(p))).status).toBe(200);
    }
  });
});

describe("middleware — cookie session ikut redirect (anti 'login hilang')", () => {
  it("redirect MEMBAWA cookie hasil rotasi token getUser()", async () => {
    mockUser = verifiedUser;
    rotateSession = true;
    const res = await middleware(makeRequest("/auth/register"));
    expect(res.status).toBe(307);
    const setCookies = res.headers.getSetCookie();
    expect(
      setCookies.some((c) => c.includes("sb-account-refresh-token=baru-terrotasi")),
    ).toBe(true);
  });

  it("response normal (tanpa redirect) juga membawa cookie rotasi", async () => {
    mockUser = verifiedUser;
    rotateSession = true;
    const res = await middleware(makeRequest("/"));
    // "/" tidak ada di matcher secara normal, tapi middleware dipanggil langsung
    // di test — pastikan cookie tetap ada di response next().
    expect(
      res.headers.getSetCookie().some((c) => c.includes("sb-account-refresh-token")),
    ).toBe(true);
  });
});
