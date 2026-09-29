/**
 * Downloader lewat Cobalt #2: /api/pinterest & /api/soundcloud.
 *
 * Yang dikunci di sini:
 *  - validasi URL per platform (yang sah lolos, yang bukan lagu/pin ditolak
 *    dengan 400 — bukan diteruskan ke Cobalt);
 *  - kontrak permintaan ke Cobalt: POST ke COBALT_API_URL_2, downloadMode
 *    "auto" (Pinterest) / "audio" (SoundCloud), dan KEDUA bentuk header API
 *    key terkirim;
 *  - bentuk respons { ok, url, filename } + nama file cadangan;
 *  - env belum diisi / bukan https → 503, dan API key TIDAK pernah bocor ke
 *    respons;
 *  - rate limit 10 permintaan per menit per IP.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET as pinterestGET } from "@/app/api/pinterest/route";
import { GET as soundcloudGET } from "@/app/api/soundcloud/route";

const COBALT_URL = "https://cobalt-instance2.railway.app";
const COBALT_KEY = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Setiap test pakai IP sendiri supaya limiter in-memory tidak saling ganggu. */
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

function request(path: "pinterest" | "soundcloud", url: string, ip = nextIp()): NextRequest {
  return new NextRequest(`http://localhost/api/${path}?url=${encodeURIComponent(url)}`, {
    headers: { "x-forwarded-for": ip },
  });
}

/** Balasan Cobalt palsu; menyimpan argumen fetch terakhir untuk diperiksa. */
const fetchMock = vi.fn();

function cobaltReplies(body: unknown, init: { status?: number } = {}) {
  // Response baru tiap panggilan: body sebuah Response hanya bisa dibaca sekali,
  // sedangkan beberapa test memanggil route lebih dari satu kali.
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

function lastRequestInit(): { headers: Record<string, string>; body: Record<string, unknown> } {
  const call = fetchMock.mock.calls.at(-1);
  const init = (call?.[1] ?? {}) as { headers?: Record<string, string>; body?: string };
  return {
    headers: init.headers ?? {},
    body: JSON.parse(init.body ?? "{}") as Record<string, unknown>,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("COBALT_API_URL_2", COBALT_URL);
  vi.stubEnv("COBALT_API_KEY_2", COBALT_KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/pinterest", () => {
  it("pin yang sah → { ok, url, filename } dari Cobalt", async () => {
    cobaltReplies({ status: "tunnel", url: "https://cobalt2/tunnel/abc", filename: "pin.jpg" });

    const res = await pinterestGET(request("pinterest", "https://www.pinterest.com/pin/1234567890/"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, url: "https://cobalt2/tunnel/abc", filename: "pin.jpg" });
  });

  it("mengirim downloadMode auto + kedua bentuk header API key ke COBALT_API_URL_2", async () => {
    cobaltReplies({ status: "tunnel", url: "https://cobalt2/tunnel/abc", filename: "pin.jpg" });

    await pinterestGET(request("pinterest", "https://www.pinterest.com/pin/1234567890/"));

    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(COBALT_URL);
    const { headers, body } = lastRequestInit();
    expect(body).toEqual({ url: "https://www.pinterest.com/pin/1234567890/", downloadMode: "auto" });
    expect(headers.Authorization).toBe(`Api-Key ${COBALT_KEY}`);
    expect(headers["Api-Key"]).toBe(COBALT_KEY);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it.each([
    ["subdomain negara", "https://id.pinterest.com/pin/1234567890/"],
    ["tanpa scheme", "www.pinterest.com/pin/1234567890/"],
    ["ccTLD", "https://pinterest.co.uk/pin/1234567890/"],
    ["varian AMP", "https://www.pinterest.com/amp/pin/1234567890/"],
    ["tautan pendek pin.it", "https://pin.it/AbCdEfG"],
  ])("menerima %s", async (_label, url) => {
    cobaltReplies({ status: "redirect", url: "https://cdn.pinimg.com/x.mp4" });

    const res = await pinterestGET(request("pinterest", url));

    expect(res.status).toBe(200);
  });

  it.each([
    ["papan/board", "https://www.pinterest.com/user/board/"],
    ["profil", "https://www.pinterest.com/user/"],
    ["host mirip", "https://notpinterest.com/pin/1234567890/"],
    ["host lain di ekor", "https://pinterest.com.evil.net/pin/123/"],
    ["platform lain", "https://www.instagram.com/reel/abc/"],
  ])("menolak %s dengan 400 tanpa memanggil Cobalt", async (_label, url) => {
    const res = await pinterestGET(request("pinterest", url));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("url kosong → 400", async () => {
    const res = await pinterestGET(new NextRequest("http://localhost/api/pinterest"));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nama file cadangan dipakai saat Cobalt tidak mengirim filename", async () => {
    cobaltReplies({ status: "redirect", url: "https://cdn.pinimg.com/originals/x.jpg" });

    const res = await pinterestGET(request("pinterest", "https://www.pinterest.com/pin/998877/"));
    const body = await res.json();

    expect(body.filename).toBe("pinterest-998877.jpg");
  });

  it("picker (banyak media) → 422, bukan 500", async () => {
    cobaltReplies({ status: "picker", picker: [] });

    const res = await pinterestGET(request("pinterest", "https://www.pinterest.com/pin/1234567890/"));

    expect(res.status).toBe(422);
  });
});

describe("GET /api/soundcloud", () => {
  it("lagu yang sah → { ok, url, filename } dengan downloadMode audio", async () => {
    cobaltReplies({ status: "tunnel", url: "https://cobalt2/tunnel/song", filename: "artis - lagu.mp3" });

    const res = await soundcloudGET(request("soundcloud", "https://soundcloud.com/artis/judul-lagu"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.url).toBe("https://cobalt2/tunnel/song");
    expect(lastRequestInit().body.downloadMode).toBe("audio");
  });

  it("nama file dari Cobalt dibersihkan (tanpa spasi/karakter aneh)", async () => {
    cobaltReplies({ status: "tunnel", url: "https://cobalt2/tunnel/song", filename: "artis - lagu.mp3" });

    const res = await soundcloudGET(request("soundcloud", "https://soundcloud.com/artis/judul-lagu"));
    const body = await res.json();

    expect(body.filename).toBe("artis_-_lagu.mp3");
    expect(body.filename).not.toMatch(/[\\/\s]/);
  });

  it("tanpa filename → nama cadangan berekstensi mp3", async () => {
    cobaltReplies({ status: "tunnel", url: "https://cobalt2/tunnel/song" });

    const res = await soundcloudGET(request("soundcloud", "https://soundcloud.com/artis/judul-lagu"));
    const body = await res.json();

    expect(body.filename).toBe("soundcloud-artis-judul-lagu.mp3");
  });

  it("menerima tautan pendek on.soundcloud.com", async () => {
    cobaltReplies({ status: "tunnel", url: "https://cobalt2/tunnel/song" });

    const res = await soundcloudGET(request("soundcloud", "https://on.soundcloud.com/AbCdEf"));

    expect(res.status).toBe(200);
  });

  it.each([
    ["profil artis saja", "https://soundcloud.com/artis"],
    ["playlist / set", "https://soundcloud.com/artis/sets/album-ku"],
    ["halaman internal", "https://soundcloud.com/discover/sets/personalized"],
    ["host lain", "https://soundcloud.evil.net/artis/lagu"],
  ])("menolak %s dengan 400 tanpa memanggil Cobalt", async (_label, url) => {
    const res = await soundcloudGET(request("soundcloud", url));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("konfigurasi & keamanan", () => {
  it("COBALT_API_URL_2 kosong → 503 dan Cobalt tidak dipanggil", async () => {
    vi.stubEnv("COBALT_API_URL_2", "");

    const res = await pinterestGET(request("pinterest", "https://www.pinterest.com/pin/1234567890/"));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.message).toContain("tidak tersedia");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("COBALT_API_URL_2 bukan https → 503", async () => {
    vi.stubEnv("COBALT_API_URL_2", "http://cobalt-instance2.railway.app");

    const res = await soundcloudGET(request("soundcloud", "https://soundcloud.com/artis/judul-lagu"));

    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("API key tidak pernah ikut ke respons — sukses maupun gagal", async () => {
    cobaltReplies({ status: "tunnel", url: "https://cobalt2/tunnel/abc", filename: "pin.jpg" });
    const okBody = await (await pinterestGET(request("pinterest", "https://pin.it/AbCdEfG"))).text();

    cobaltReplies({ status: "error", error: { code: "error.api.auth.key.invalid" } }, { status: 401 });
    const errBody = await (await pinterestGET(request("pinterest", "https://pin.it/AbCdEfG"))).text();

    expect(okBody).not.toContain(COBALT_KEY);
    expect(errBody).not.toContain(COBALT_KEY);
  });

  it("key ditolak Cobalt → 503 (masalah server), bukan 400 ke user", async () => {
    cobaltReplies({ status: "error", error: { code: "error.api.auth.key.missing" } }, { status: 401 });

    const res = await soundcloudGET(request("soundcloud", "https://soundcloud.com/artis/judul-lagu"));

    expect(res.status).toBe(503);
  });

  it("Cobalt kena rate limit → 503 'sedang sibuk'", async () => {
    cobaltReplies({ status: "error", error: { code: "error.api.rate_exceeded" } }, { status: 429 });

    const res = await pinterestGET(request("pinterest", "https://www.pinterest.com/pin/1234567890/"));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.message).toContain("sibuk");
  });

  it("respons Cobalt bukan JSON → 502, bukan 500", async () => {
    fetchMock.mockImplementation(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }));

    const res = await pinterestGET(request("pinterest", "https://www.pinterest.com/pin/1234567890/"));

    expect(res.status).toBe(502);
  });

  it("rate limit: permintaan ke-11 dari IP yang sama → 429", async () => {
    cobaltReplies({ status: "tunnel", url: "https://cobalt2/tunnel/abc", filename: "pin.jpg" });
    const ip = "198.51.100.77";

    for (let i = 0; i < 10; i += 1) {
      const res = await pinterestGET(request("pinterest", "https://www.pinterest.com/pin/1234567890/", ip));
      expect(res.status).toBe(200);
    }

    const blocked = await pinterestGET(
      request("pinterest", "https://www.pinterest.com/pin/1234567890/", ip),
    );
    const body = await blocked.json();

    expect(blocked.status).toBe(429);
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
  });
});
