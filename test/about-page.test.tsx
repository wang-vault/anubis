/**
 * HALAMAN TENTANG KAMI (/about) — halaman profil publik.
 *
 * Yang dikunci file ini:
 *  - publik: tidak di-gate middleware (tamu boleh baca, tanpa akun);
 *  - isinya menjelaskan satu-satunya metode bayar + alur 4 langkah + FAQ;
 *  - angka yang ditampilkan IKUT konfigurasi penjual (masa bayar pesanan),
 *    bukan angka yang ditulis keras di halaman;
 *  - tombol chat penjual hanya muncul bila nomor WhatsApp sudah diatur —
 *    kalau belum, halaman menjelaskannya (bukan tombol mati);
 *  - CTA menyesuaikan status login (tamu → daftar, sudah login → pesanan);
 *  - aturan satu pintu masuk downloader tetap dipatuhi: TEPAT satu tautan ke
 *    /downloader, tanpa tautan langsung ke halaman downloader mana pun;
 *  - Header & Footer menautkan halaman ini tepat sekali.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const auth = vi.hoisted(() => ({
  ctx: null as null | { profile: { name: string; role: string } },
}));

/** Konfigurasi pembayaran manual yang bisa diubah per test. */
const payment = vi.hoisted(() => ({
  view: {
    available: true,
    schemaReady: true,
    reason: null,
    isEnabled: true,
    envEnabled: true,
    numberFromDatabase: true,
    label: "Transfer Manual (WhatsApp)",
    sellerName: "Toko Anubis",
    instructions: "Detail pembayaran dikirim penjual lewat chat WhatsApp.",
    expiryMinutes: 120,
    whatsappNumber: "6281234567890" as string | null,
    whatsappDisplay: "+62 812-3456-7890" as string | null,
    messageTemplate: "Halo {toko}",
    updatedAt: null as string | null,
  },
}));

vi.mock("@/lib/authz", () => ({
  getAuthContext: async () => auth.ctx,
  isAdmin: (ctx: typeof auth.ctx) => ctx?.profile?.role === "admin",
}));

vi.mock("@/lib/payment-config", () => ({
  getManualPaymentView: async () => payment.view,
}));

// Header memakai server action + tombol pending yang butuh request context Next.
vi.mock("@/app/auth/actions", () => ({
  signOutAction: async () => {},
}));

vi.mock("@/components/ActionButton", () => ({
  ActionButton: ({ pendingText: _pendingText, ...props }: Record<string, unknown>) => (
    <button {...props} />
  ),
}));

import AboutPage from "@/app/about/page";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { config as middlewareConfig } from "@/middleware";
import { DOWNLOADER_HUB_PATH, DOWNLOADERS } from "@/lib/downloaders";

const ABOUT_PATH = "/about";

/** Jumlah tautan dengan href PERSIS ini. */
function countHref(html: string, href: string): number {
  return html.split(`href="${href}"`).length - 1;
}

async function renderAbout(): Promise<string> {
  return renderToStaticMarkup(await AboutPage());
}

beforeEach(() => {
  auth.ctx = null;
  payment.view.expiryMinutes = 120;
  payment.view.whatsappNumber = "6281234567890";
  payment.view.whatsappDisplay = "+62 812-3456-7890";
  payment.view.sellerName = "Toko Anubis";
});

describe("/about — publik & bisa ditemukan", () => {
  it("tidak di-gate middleware (tamu boleh baca tanpa login)", () => {
    const gated = middlewareConfig.matcher;
    expect(gated.some((m) => m === ABOUT_PATH || m.startsWith(`${ABOUT_PATH}/`))).toBe(false);
  });

  it("Header menautkan Tentang tepat sekali (tamu maupun penjual login)", async () => {
    expect(countHref(renderToStaticMarkup(await Header()), ABOUT_PATH)).toBe(1);

    auth.ctx = { profile: { name: "Penjual", role: "admin" } };
    const loggedIn = renderToStaticMarkup(await Header());
    expect(countHref(loggedIn, ABOUT_PATH)).toBe(1);
    expect(loggedIn).toContain("Tentang</a>");
  });

  it("Footer menautkan Tentang kami tepat sekali", async () => {
    const html = renderToStaticMarkup(await Footer());

    expect(countHref(html, ABOUT_PATH)).toBe(1);
    expect(html).toContain("Tentang kami");
  });
});

describe("/about — isi halaman", () => {
  it("menjelaskan profil toko, alur 4 langkah, dan FAQ tanpa JS klien", async () => {
    const html = await renderAbout();

    expect(html).toContain("Tentang");
    // Empat langkah alur belanja.
    for (const n of ["01", "02", "03", "04"]) {
      expect(html).toContain(`>${n}</span>`);
    }
    // FAQ memakai <details> asli (buka-tutup tanpa JavaScript).
    expect(html.split("<details").length - 1).toBeGreaterThanOrEqual(5);
    expect(html).toContain("Pertanyaan yang sering masuk");
    // Metode bayar tunggal disebut eksplisit.
    expect(html).toContain("Transfer manual");
  });

  it("masa bayar pesanan mengikuti pengaturan penjual, bukan angka tetap", async () => {
    payment.view.expiryMinutes = 45;

    const html = await renderAbout();

    expect(html).toContain("45 menit");
    expect(html).not.toContain("120 menit");
  });

  it("satu pintu masuk downloader tetap dipatuhi", async () => {
    const html = await renderAbout();

    expect(countHref(html, DOWNLOADER_HUB_PATH)).toBe(1);
    for (const tool of DOWNLOADERS) {
      expect(countHref(html, tool.href), `tautan langsung ke ${tool.href}`).toBe(0);
    }
  });
});

describe("/about — kontak penjual", () => {
  it("menampilkan tombol chat WhatsApp saat nomor penjual sudah diatur", async () => {
    const html = await renderAbout();

    expect(html).toContain("https://wa.me/6281234567890?text=");
    expect(html).toContain("+62 812-3456-7890");
    expect(html).toContain("Toko Anubis");
  });

  it("tanpa nomor penjual: tidak ada tombol mati, ada penjelasannya", async () => {
    payment.view.whatsappNumber = null;
    payment.view.whatsappDisplay = null;
    payment.view.sellerName = "";

    const html = await renderAbout();

    expect(html).not.toContain("https://wa.me/");
    expect(html).toContain("Nomor WhatsApp penjual belum ditampilkan");
    // Pembaca tetap punya jalan ke katalog.
    expect(countHref(html, "/products")).toBeGreaterThanOrEqual(1);
  });
});

describe("/about — CTA mengikuti status login", () => {
  it("tamu diajak membuat akun (bukan tautan pesanan yang memantul)", async () => {
    const html = await renderAbout();

    expect(countHref(html, "/auth/register")).toBe(1);
    expect(countHref(html, "/orders")).toBe(0);
  });

  it("user yang sudah login diarahkan ke pesanannya", async () => {
    auth.ctx = { profile: { name: "Budi", role: "buyer" } };

    const html = await renderAbout();

    expect(countHref(html, "/orders")).toBe(1);
    expect(countHref(html, "/auth/register")).toBe(0);
  });
});
