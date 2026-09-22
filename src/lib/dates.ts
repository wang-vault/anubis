/**
 * Toko beroperasi dalam WIB (Asia/Jakarta, UTC+7, tanpa DST).
 * Helper untuk "awal hari" yang dipakai statistik admin.
 */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

function jakartaParts(now: Date): { y: number; m: number; d: number } {
  const jakartaNow = new Date(now.getTime() + JAKARTA_OFFSET_MS);
  return {
    y: jakartaNow.getUTCFullYear(),
    m: jakartaNow.getUTCMonth(),
    d: jakartaNow.getUTCDate(),
  };
}

export function jakartaDayStartISO(now: Date = new Date()): string {
  const { y, m, d } = jakartaParts(now);
  return new Date(Date.UTC(y, m, d) - JAKARTA_OFFSET_MS).toISOString();
}

export function jakartaMonthStartISO(now: Date = new Date()): string {
  const { y, m } = jakartaParts(now);
  return new Date(Date.UTC(y, m, 1) - JAKARTA_OFFSET_MS).toISOString();
}

export function formatDateTimeId(iso: string | null): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** Tanggal saja (tanpa jam) — mis. "22 Sep 2026" — untuk tampilan publik. */
export function formatDateId(iso: string | null): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
  }).format(new Date(iso));
}
