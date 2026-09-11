import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Upload gambar QR pembayaran manual lewat server action (maks ~900 KB
      // divalidasi aplikasi; beri sedikit ruang untuk field form lainnya).
      bodySizeLimit: "2mb",
    },
  },
  images: {
    // Gambar produk berasal dari URL yang diisi owner (berbagai hosting).
    // Optimizer Next dibatasi agar tidak jadi proxy image tak terbatas.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
