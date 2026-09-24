/**
 * SMOKE TEST NAVIGASI DOWNLOADER — satu pintu masuk.
 *
 * Aturannya: halaman lain (header, footer, beranda) cukup punya SATU tombol
 * "Downloader" menuju halaman pemilih /downloader. Di sana pengunjung baru
 * memilih TikTok / YouTube / Instagram — masing-masing dengan tombolnya
 * sendiri. File ini mengunci janji itu:
 *  - Header (tamu & penjual yang sedang di dashboard), Footer, beranda:
 *    tepat satu tautan ke /downloader dan TIDAK ada tautan langsung ke
 *    halaman downloader mana pun;
 *  - halaman /downloader: satu tombol per downloader terdaftar, setiap entri
 *    menunjuk halaman yang benar-benar ada, dan halamannya publik;
 *  - setiap halaman downloader: tautan kembali ke /downloader + form-nya.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Status login bisa diganti per test (tamu ↔ penjual login).
const auth = vi.hoisted(() => ({
  ctx: null as null | { profile: { name: string; role: string } },
}));

vi.mock("@/lib/authz", () => ({
  getAuthContext: async () => auth.ctx,
  isAdmin: (ctx: typeof auth.ctx) => ctx?.profile?.role === "admin",
}));

// Beranda membaca katalog; kosong saja — yang diuji tautan alatnya, bukan produk.
vi.mock("@/lib/products", () => ({
  listActiveProducts: async () => [],
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

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import HomePage from "@/app/page";
import DownloaderHubPage from "@/app/downloader/page";
import { config as middlewareConfig } from "@/middleware";
import { DOWNLOADER_HUB_PATH, DOWNLOADERS } from "@/lib/downloaders";

const APP_DIR = path.resolve(__dirname, "../src/app");

/** Jumlah tautan dengan href PERSIS ini (bukan "/x/…" atau "/xyz"). */
function countHref(html: string, href: string): number {
  return html.split(`href="${href}"`).length - 1;
}

/** Tepat satu tombol ke halaman pemilih, nol tautan langsung ke downloader. */
function expectSingleDownloaderEntry(html: string) {
  expect(countHref(html, DOWNLOADER_HUB_PATH), "jumlah tautan ke /downloader").toBe(1);
  for (const tool of DOWNLOADERS) {
    expect(countHref(html, tool.href), `tautan langsung ke ${tool.href}`).toBe(0);
  }
}

beforeEach(() => {
  auth.ctx = null;
});

describe("halaman lain: cukup satu tombol Downloader → /downloader", () => {
  it("Header (tamu): satu tombol Downloader, tanpa tautan langsung ke tiap downloader", async () => {
    const html = renderToStaticMarkup(await Header());

    expectSingleDownloaderEntry(html);
    expect(html).toContain("Downloader</a>");
  });

  it("Header (penjual login, mis. di dashboard): tombol yang sama tetap satu-satunya", async () => {
    auth.ctx = { profile: { name: "Penjual", role: "admin" } };
    const html = renderToStaticMarkup(await Header());

    expect(html).toContain('href="/admin"'); // memang header versi penjual
    expectSingleDownloaderEntry(html);
  });

  it("Footer: satu tautan Downloader di daftar Jelajahi", async () => {
    const html = renderToStaticMarkup(await Footer());

    expectSingleDownloaderEntry(html);
  });

  it("Beranda: teaser dengan SATU tombol Buka Downloader; platform hanya keterangan", async () => {
    const html = renderToStaticMarkup(await HomePage());

    expectSingleDownloaderEntry(html);
    expect(html).toContain("Buka Downloader");
    for (const tool of DOWNLOADERS) {
      expect(html).toContain(`<li>${tool.platform}</li>`);
    }
  });
});

describe("halaman pemilih /downloader", () => {
  it("memuat TikTok, YouTube, dan Instagram", () => {
    expect(DOWNLOADERS.map((t) => t.slug)).toEqual(expect.arrayContaining(["tiktok", "youtube", "instagram"]));
  });

  it("setiap downloader punya kartu + tombolnya sendiri", () => {
    const html = renderToStaticMarkup(<DownloaderHubPage />);

    expect(html).toContain("Pilih downloader");
    for (const tool of DOWNLOADERS) {
      expect(countHref(html, tool.href), `tombol ${tool.name}`).toBe(1);
      expect(html).toContain(`Buka ${tool.name}`);
    }
  });

  it("setiap entri menunjuk halaman yang benar-benar ada (tidak ada tautan mati)", () => {
    expect(existsSync(path.join(APP_DIR, DOWNLOADER_HUB_PATH.slice(1), "page.tsx"))).toBe(true);
    expect(new Set(DOWNLOADERS.map((t) => t.slug)).size).toBe(DOWNLOADERS.length);

    for (const tool of DOWNLOADERS) {
      expect(tool.href).toBe(`/${tool.slug}`);
      expect(existsSync(path.join(APP_DIR, tool.slug, "page.tsx")), `src/app/${tool.slug}/page.tsx`).toBe(true);
    }
  });

  it("publik: /downloader dan halaman downloader tidak di-gate middleware (tanpa login)", () => {
    const gated = middlewareConfig.matcher;
    for (const href of [DOWNLOADER_HUB_PATH, ...DOWNLOADERS.map((t) => t.href)]) {
      expect(gated.some((m) => m === href || m.startsWith(`${href}/`)), href).toBe(false);
    }
  });
});

describe("setiap halaman downloader", () => {
  it.each(DOWNLOADERS.map((t) => [t.href, t.slug] as const))(
    "%s: tautan kembali ke /downloader + form tempel tautan",
    async (_href, slug) => {
      const mod = (await import(`../src/app/${slug}/page.tsx`)) as { default: ComponentType };
      const Page = mod.default;
      const html = renderToStaticMarkup(<Page />);

      expect(countHref(html, DOWNLOADER_HUB_PATH)).toBe(1);
      expect(html).toContain("Pilih downloader lain");
      expect(html).toContain(`id="${slug}-url"`);
      expect(html).toContain("Proses");
    },
  );
});
