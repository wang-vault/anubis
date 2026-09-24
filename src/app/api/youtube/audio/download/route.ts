import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const FETCH_TIMEOUT_MS = 60_000;

function cobaltOrigin(): string {
  const raw = process.env.COBALT_API_URL?.trim() ?? "";
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

export async function GET(request: NextRequest) {
  const rl = rateLimit(
    `ytdl:${clientIp(request.headers)}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan. Coba lagi dalam beberapa saat." },
      { status: 429 },
    );
  }

  const rawUrl = request.nextUrl.searchParams.get("url")?.trim() ?? "";
  const filename =
    request.nextUrl.searchParams.get("filename")?.trim() || "audio.mp3";

  if (!rawUrl) {
    return NextResponse.json({ error: "Parameter url wajib diisi." }, { status: 400 });
  }

  const allowedOrigin = cobaltOrigin();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "URL tidak valid." }, { status: 400 });
  }

  if (allowedOrigin && parsedUrl.origin !== allowedOrigin) {
    return NextResponse.json(
      { error: "URL tidak diizinkan." },
      { status: 403 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(rawUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "AnubisStore/1.0" },
    });
  } catch {
    return NextResponse.json(
      { error: "Gagal mengambil file dari server. Coba proses ulang videonya." },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "Tautan unduh sudah kedaluwarsa. Silakan proses ulang videonya." },
      { status: 410 },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "audio/mpeg";
  const safeFilename = filename.replace(/[^\w\s.\-()]/g, "_");

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Cache-Control": "no-store",
    },
  });
}
