/**
 * SMOKE TEST PINTU MASUK TIKTOK DOWNLOADER.
 *
 * Halaman `/tiktok` adalah fitur publik terpisah dari toko. Dulu satu-satunya
 * cara membukanya adalah mengetik URL-nya sendiri — tidak ada satu pun tautan
 * di UI. File ini mengunci janji sebaliknya di tiga tempat:
 *  - navigasi utama (Header) → terlihat di SEMUA halaman publik,
 *  - daftar "Jelajahi" di Footer,
 *  - teaser dengan tombol besar di beranda.
 * Ditambah satu cek bahwa halaman /tiktok sendiri benar-benar merender form
 * tempel-tautan (bukan halaman kosong).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Header/Footer membaca status login; tanpa session → tamu (tombol masuk/daftar).
vi.mock("@/lib/authz", () => ({
  getAuthContext: async () => null,
  isAdmin: () => false,
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
import TikTokDownloaderPage from "@/app/tiktok/page";

describe("navigasi ke /tiktok", () => {
  it("Header punya tautan TikTok Downloader di navigasi utama", async () => {
    const html = renderToStaticMarkup(await Header());

    expect(html).toContain('href="/tiktok"');
    expect(html).toContain("TikTok Downloader");
  });

  it("Footer punya tautan TikTok downloader di daftar Jelajahi", async () => {
    const html = renderToStaticMarkup(await Footer());

    expect(html).toContain('href="/tiktok"');
  });

  it("Beranda menampilkan teaser dengan tombol menuju alatnya", async () => {
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('href="/tiktok"');
    expect(html).toContain("Buka TikTok Downloader");
  });

  it("halaman /tiktok merender form tempel tautan beserta tombol proses", () => {
    const html = renderToStaticMarkup(<TikTokDownloaderPage />);

    expect(html).toContain('id="tiktok-url"');
    expect(html).toContain("Proses");
  });
});
