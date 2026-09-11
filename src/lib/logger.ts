/**
 * Logger terpusat. Format JSON satu baris agar mudah dicari di Vercel Logs.
 * Aturan: JANGAN pernah log secret (api key, token, service role, webhook secret).
 * Pesan error yang dikirim ke user harus generic; detail lengkap hanya ke log.
 */
type Meta = Record<string, unknown>;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const log = {
  info(event: string, meta?: Meta): void {
    console.log(safeStringify({ level: "info", event, ...meta }));
  },
  warn(event: string, meta?: Meta): void {
    console.warn(safeStringify({ level: "warn", event, ...meta }));
  },
  error(event: string, meta?: Meta): void {
    console.error(safeStringify({ level: "error", event, ...meta }));
  },
  errorFrom(event: string, err: unknown, meta?: Meta): void {
    const e =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { message: String(err) };
    console.error(safeStringify({ level: "error", event, ...meta, err: e }));
  },
};
