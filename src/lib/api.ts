import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { log } from "@/lib/logger";

/**
 * Error handling API terpusat.
 * User hanya boleh melihat pesan yang aman & actionable.
 * Detail internal (stack, DB error, response provider mentah) hanya ke log.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const ErrorCodes = {
  validation: "VALIDATION_ERROR",
  unauthorized: "UNAUTHORIZED",
  emailNotVerified: "EMAIL_NOT_VERIFIED",
  forbidden: "FORBIDDEN",
  notFound: "NOT_FOUND",
  conflict: "CONFLICT",
  tooManyRequests: "TOO_MANY_REQUESTS",
  paymentUnavailable: "PAYMENT_UNAVAILABLE",
  internal: "INTERNAL_ERROR",
} as const;

export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Bungkus handler agar semua throw (Zod/HttpError/unknown) tertangani rapi. */
export async function handleApi<T>(
  fn: () => Promise<T>,
  toResponse: (value: T) => NextResponse,
): Promise<NextResponse> {
  try {
    const value = await fn();
    return toResponse(value);
  } catch (err) {
    if (err instanceof HttpError) {
      return errorResponse(err.status, err.code, err.message);
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return errorResponse(
        400,
        ErrorCodes.validation,
        first ? `${first.path.join(".")}: ${first.message}` : "Data tidak valid",
      );
    }
    if (err instanceof SyntaxError) {
      // request.json() gagal → body bukan JSON valid (bukan bug server).
      return errorResponse(400, ErrorCodes.validation, "Body harus JSON yang valid.");
    }
    log.errorFrom("unhandled_api_error", err);
    return errorResponse(
      500,
      ErrorCodes.internal,
      "Terjadi kesalahan pada server. Silakan coba lagi beberapa saat.",
    );
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
