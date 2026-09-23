import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import YouTubeDownloaderPage from "@/app/youtube/page";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.COBALT_API_URL = "https://cobalt.up.railway.app";
  vi.restoreAllMocks();
});

/**
 * Buat request GET /api/youtube/download. Setiap test memakai IP
 * x-forwarded-for yang unik agar tidak saling mengganggu bucket rate
 * limiter in-memory yang hidup di level modul.
 */
function makeReq(query: string, ip: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/youtube/download${query ? `?${query}` : ""}`,
    { headers: { "x-forwarded-for": ip } },
  );
}

const FAKE_STREAM_DATA = "video-content-stream-bytes";

function mockFetchOk(): void {
  const fakeStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(FAKE_STREAM_DATA));
      controller.close();
    },
  });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(fakeStream, {
      status: 200,
      headers: { "content-type": "video/mp4" },
    }),
  );
}

describe("GET /api/youtube/download", () => {
  it("menolak request bila parameter url kosong (400)", async () => {
    const { GET } = await import("@/app/api/youtube/download/route");
    const res = await GET(makeReq("", "10.0.0.1"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Parameter url wajib diisi.");
  });

  it("menolak request bila url bukan dari domain Cobalt yang diset di COBALT_API_URL (403)", async () => {
    const { GET } = await import("@/app/api/youtube/download/route");

    const badUrls = [
      "https://google.com/video.mp4",
      "https://youtube.com/watch?v=123",
      "https://attacker-cobalt.up.railway.app/video.mp4",
      "https://cobalt.up.railway.app.attacker.com/video.mp4",
      "javascript:alert(1)",
    ];

    for (const badUrl of badUrls) {
      const res = await GET(
        makeReq(`url=${encodeURIComponent(badUrl)}&filename=test.mp4`, "10.0.0.2"),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("URL tidak diizinkan.");
    }
  });

  it("menolak string URL yang tidak bisa di-parse (400)", async () => {
    const { GET } = await import("@/app/api/youtube/download/route");
    const res = await GET(
      makeReq(`url=${encodeURIComponent("bukan-url-valid")}&filename=test.mp4`, "10.0.0.3"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("URL tidak valid.");
  });

  it("mengizinkan URL apa pun bila COBALT_API_URL tidak diset (perhatian: open proxy)", async () => {
    delete process.env.COBALT_API_URL;
    const { GET } = await import("@/app/api/youtube/download/route");
    mockFetchOk();

    const res = await GET(
      makeReq(
        `url=${encodeURIComponent("https://cobalt.up.railway.app/video.mp4")}&filename=test.mp4`,
        "10.0.0.4",
      ),
    );
    expect(res.status).toBe(200);
  });

  it("menolak (410) bila upstream merespons tidak ok — tautan kedaluwarsa", async () => {
    const { GET } = await import("@/app/api/youtube/download/route");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("expired", { status: 404 }),
    );

    const res = await GET(
      makeReq(
        `url=${encodeURIComponent("https://cobalt.up.railway.app/video.mp4")}&filename=test.mp4`,
        "10.0.0.5",
      ),
    );

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toContain("kedaluwarsa");
  });

  it("menolak (502) bila fetch ke upstream gagal", async () => {
    const { GET } = await import("@/app/api/youtube/download/route");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));

    const res = await GET(
      makeReq(
        `url=${encodeURIComponent("https://cobalt.up.railway.app/video.mp4")}&filename=test.mp4`,
        "10.0.0.6",
      ),
    );

    expect(res.status).toBe(502);
  });

  it("berhasil streaming file dengan header Content-Disposition yang tepat", async () => {
    const { GET } = await import("@/app/api/youtube/download/route");
    mockFetchOk();

    const validUrl = "https://cobalt.up.railway.app/tunnel/download?id=abc";
    const res = await GET(
      makeReq(`url=${encodeURIComponent(validUrl)}&filename=my_video.mp4`, "10.0.0.7"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="my_video.mp4"');
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const text = await res.text();
    expect(text).toBe(FAKE_STREAM_DATA);
  });

  it("menerapkan rate limit 10 req / 60 detik per IP", async () => {
    const { GET } = await import("@/app/api/youtube/download/route");
    mockFetchOk();

    const testIp = "192.168.1.100";
    const makeRateLimitReq = () =>
      makeReq("url=https%3A%2F%2Fcobalt.up.railway.app%2Fvideo.mp4", testIp);

    // 10 permintaan pertama berhasil (200)
    for (let i = 0; i < 10; i++) {
      const res = await GET(makeRateLimitReq());
      expect(res.status).toBe(200);
    }

    // Permintaan ke-11 diblokir rate limit (429)
    const blockedRes = await GET(makeRateLimitReq());
    expect(blockedRes.status).toBe(429);
  });
});

describe("src/app/youtube/page.tsx", () => {
  it("halaman merender form input dan hint", () => {
    const html = renderToStaticMarkup(<YouTubeDownloaderPage />);
    expect(html).toContain('id="youtube-url"');
    expect(html).toContain("YouTube Downloader");
  });
});
