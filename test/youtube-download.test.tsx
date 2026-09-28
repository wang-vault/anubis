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

  it("meneruskan tunnel dari origin/subdomain lain — Cobalt tidak selalu memakai origin COBALT_API_URL (200)", async () => {
    // Regresi bug "file 0B": dulu URL dikunci ke origin COBALT_API_URL,
    // sehingga tunnel dari subdomain lain ditolak 403 dan stream jadi kosong.
    const { GET } = await import("@/app/api/youtube/download/route");
    mockFetchOk();

    const res = await GET(
      makeReq(
        `url=${encodeURIComponent("https://tunnel-eu-3.up.railway.app/tunnel?id=abc")}&filename=test.mp4`,
        "10.0.0.2",
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(FAKE_STREAM_DATA);
  });

  it("menolak URL non-HTTPS (403)", async () => {
    const { GET } = await import("@/app/api/youtube/download/route");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const badUrls = [
      "http://cobalt.up.railway.app/video.mp4",
      "javascript:alert(1)",
      "data:text/plain,halo",
      "file:///etc/passwd",
    ];

    let ip = 20;
    for (const badUrl of badUrls) {
      const res = await GET(
        makeReq(`url=${encodeURIComponent(badUrl)}&filename=test.mp4`, `10.0.1.${ip++}`),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("URL tidak diizinkan.");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("menolak URL yang menunjuk ke host lokal/privat — anti-SSRF (403)", async () => {
    const { GET } = await import("@/app/api/youtube/download/route");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const badUrls = [
      "https://localhost/video.mp4",
      "https://127.0.0.1/video.mp4",
      "https://0.0.0.0/video.mp4",
      "https://10.1.2.3/video.mp4",
      "https://192.168.1.10/video.mp4",
      "https://172.16.5.4/video.mp4",
      "https://172.31.255.255/video.mp4",
      "https://169.254.169.254/latest/meta-data/",
      "https://2130706433/video.mp4", // 127.0.0.1 bentuk desimal
      "https://[::1]/video.mp4",
      "https://[fd00::1]/video.mp4",
    ];

    let ip = 50;
    for (const badUrl of badUrls) {
      const res = await GET(
        makeReq(`url=${encodeURIComponent(badUrl)}&filename=test.mp4`, `10.0.2.${ip++}`),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("URL tidak diizinkan.");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it("mengizinkan URL HTTPS publik lain tanpa bergantung pada COBALT_API_URL", async () => {
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
