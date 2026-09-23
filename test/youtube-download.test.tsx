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

describe("GET /api/youtube/download", () => {
  it("menolak request bila parameter url kosong (400)", async () => {
    const { GET } = await import("@/app/api/youtube/download/route");
    const req = new NextRequest("http://localhost:3000/api/youtube/download");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("menolak request bila url bukan dari domain Cobalt yang diset di COBALT_API_URL (400)", async () => {
    const { GET } = await import("@/app/api/youtube/download/route");

    const badUrls = [
      "https://google.com/video.mp4",
      "https://youtube.com/watch?v=123",
      "https://attacker-cobalt.up.railway.app/video.mp4",
      "https://cobalt.up.railway.app.attacker.com/video.mp4",
      "javascript:alert(1)",
    ];

    for (const badUrl of badUrls) {
      const req = new NextRequest(
        `http://localhost:3000/api/youtube/download?url=${encodeURIComponent(badUrl)}&filename=test.mp4`,
      );
      const res = await GET(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("menolak request bila COBALT_API_URL tidak diset (503)", async () => {
    delete process.env.COBALT_API_URL;
    const { GET } = await import("@/app/api/youtube/download/route");

    const req = new NextRequest(
      "http://localhost:3000/api/youtube/download?url=https%3A%2F%2Fcobalt.up.railway.app%2Fvideo.mp4&filename=test.mp4",
    );
    const res = await GET(req);

    expect(res.status).toBe(503);
  });

  it("berhasil streaming file dengan header Content-Disposition yang tepat", async () => {
    const { GET } = await import("@/app/api/youtube/download/route");

    const fakeStreamData = "video-content-stream-bytes";
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(fakeStreamData));
        controller.close();
      },
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(fakeStream, {
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "content-length": String(fakeStreamData.length),
        },
      }),
    );

    const validUrl = "https://cobalt.up.railway.app/tunnel/download?id=abc";
    const req = new NextRequest(
      `http://localhost:3000/api/youtube/download?url=${encodeURIComponent(validUrl)}&filename=my_video.mp4`,
    );

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="my_video.mp4"');
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-length")).toBe(String(fakeStreamData.length));

    const text = await res.text();
    expect(text).toBe(fakeStreamData);
  });

  it("menerapkan rate limit 10 req / 60 detik per IP", async () => {
    const { GET } = await import("@/app/api/youtube/download/route");

    const fakeStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(fakeStream, { status: 200 }),
    );

    const testIp = "192.168.1.100";
    const makeReq = () =>
      new NextRequest(
        "http://localhost:3000/api/youtube/download?url=https%3A%2F%2Fcobalt.up.railway.app%2Fvideo.mp4",
        {
          headers: { "x-forwarded-for": testIp },
        },
      );

    // 10 permintaan pertama berhasil (200)
    for (let i = 0; i < 10; i++) {
      const res = await GET(makeReq());
      expect(res.status).toBe(200);
    }

    // Permintaan ke-11 diblokir rate limit (429)
    const blockedRes = await GET(makeReq());
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
