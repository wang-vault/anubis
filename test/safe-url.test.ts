import { describe, expect, it } from "vitest";
import { checkDownloadUrl, isPrivateHost } from "@/lib/safe-url";

describe("checkDownloadUrl — protokol", () => {
  it("menerima URL HTTPS publik dari origin mana pun (tunnel Cobalt bisa pindah subdomain)", () => {
    for (const url of [
      "https://cobalt.up.railway.app/tunnel?id=1",
      "https://tunnel-eu-3.up.railway.app/tunnel?id=1",
      "https://api.cobalt.tools/tunnel?id=1",
      "https://rr3---sn-4g5e6nsz.googlevideo.com/videoplayback?x=1",
    ]) {
      const res = checkDownloadUrl(url);
      expect(res.ok, url).toBe(true);
      if (res.ok) expect(res.url.href).toContain("https://");
    }
  });

  it("menolak protokol selain https dengan 403", () => {
    for (const url of [
      "http://cobalt.up.railway.app/video.mp4",
      "ftp://cobalt.up.railway.app/video.mp4",
      "javascript:alert(1)",
      "data:text/plain,halo",
      "file:///etc/passwd",
      "blob:https://example.com/abc",
    ]) {
      const res = checkDownloadUrl(url);
      expect(res.ok, url).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(403);
        expect(res.error).toContain("HTTPS");
      }
    }
  });

  it("menolak string yang bukan URL dengan 400", () => {
    for (const url of ["", "bukan-url-valid", "   ", "https://"]) {
      const res = checkDownloadUrl(url);
      expect(res.ok, url).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(400);
        expect(res.error).toBe("URL tidak valid.");
      }
    }
  });
});

describe("checkDownloadUrl — host lokal/privat (anti-SSRF)", () => {
  const blocked = [
    "https://localhost/f",
    "https://LOCALHOST/f",
    "https://localhost.:8443/f", // titik akhir FQDN
    "https://app.localhost/f",
    "https://127.0.0.1/f",
    "https://127.99.88.77/f", // seluruh 127.0.0.0/8
    "https://0.0.0.0/f",
    "https://10.0.0.1/f",
    "https://10.255.255.254/f",
    "https://192.168.0.1/f",
    "https://172.16.0.1/f",
    "https://172.24.9.9/f",
    "https://172.31.255.255/f",
    "https://169.254.169.254/latest/meta-data/", // metadata cloud
    "https://2130706433/f", // 127.0.0.1 desimal
    "https://0x7f.0.0.1/f", // heksa
    "https://0177.0.0.1/f", // oktal
    "https://[::1]/f",
    "https://[::]/f",
    "https://[::ffff:7f00:1]/f", // IPv4-mapped loopback
    "https://[::ffff:c0a8:1]/f", // IPv4-mapped 192.168.0.1
    "https://[fd00::1]/f", // unique-local
    "https://[fe80::1]/f", // link-local
  ];

  for (const url of blocked) {
    it(`menolak ${url}`, () => {
      const res = checkDownloadUrl(url);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(403);
        expect(res.error).toBe("URL tidak diizinkan.");
      }
    });
  }

  const allowed = [
    "https://172.15.0.1/f", // tepat di luar 172.16.0.0/12
    "https://172.32.0.1/f", // tepat di luar 172.16.0.0/12
    "https://192.169.0.1/f", // bukan 192.168/16
    "https://11.0.0.1/f", // bukan 10/8
    "https://126.255.255.255/f", // bukan 127/8
    "https://169.253.0.1/f", // bukan 169.254/16
    "https://[2606:4700::1111]/f", // IPv6 publik
    "https://localhost.example.com/f", // hostname publik yang memuat "localhost"
    "https://mylocalhost/f",
  ];

  for (const url of allowed) {
    it(`mengizinkan ${url}`, () => {
      expect(checkDownloadUrl(url).ok).toBe(true);
    });
  }
});

describe("isPrivateHost", () => {
  it("menolak hostname kosong", () => {
    expect(isPrivateHost("")).toBe(true);
  });

  it("tidak terkecoh huruf besar dan titik akhir", () => {
    expect(isPrivateHost("LocalHost.")).toBe(true);
    expect(isPrivateHost("10.0.0.1.")).toBe(true);
  });

  it("mengizinkan hostname publik biasa", () => {
    expect(isPrivateHost("cobalt.up.railway.app")).toBe(false);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
  });
});
