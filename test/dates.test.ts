import { describe, expect, it } from "vitest";
import { jakartaDayStartISO, jakartaMonthStartISO, formatDateTimeId } from "@/lib/dates";

describe("jakartaDayStartISO", () => {
  it("11 Sep 00:30 WIB → hari mulai 10 Sep 17:00 UTC", () => {
    // 2026-09-10T17:30:00Z = 2026-09-11T00:30:00+07:00
    const iso = jakartaDayStartISO(new Date("2026-09-10T17:30:00Z"));
    expect(iso).toBe("2026-09-10T17:00:00.000Z");
  });
  it("10 Sep 23:00 WIB masih tanggal 10 (day start = 9 Sep 17:00 UTC)", () => {
    // 2026-09-10T16:00:00Z = 10 Sep 23:00 WIB → awal hari 10 Sep 00:00 WIB
    const iso = jakartaDayStartISO(new Date("2026-09-10T16:00:00Z"));
    expect(iso).toBe("2026-09-09T17:00:00.000Z");
  });
  it("batas ganti bulan (1 Okt 00:00 WIB = 30 Sep 17:00 UTC)", () => {
    const iso = jakartaMonthStartISO(new Date("2026-09-30T17:00:00Z"));
    expect(iso).toBe("2026-09-30T17:00:00.000Z"); // awal Okt → UTC 30 Sep 17:00
    const feb = jakartaMonthStartISO(new Date("2026-09-30T16:59:59Z"));
    expect(feb).toBe("2026-08-31T17:00:00.000Z"); // masih Sept → mulai 1 Sept WIB
  });
});

describe("formatDateTimeId", () => {
  it("memformat tanggal dengan zona WIB", () => {
    const s = formatDateTimeId("2026-09-11T17:00:00.000Z"); // = 12 Sep 00:00 WIB
    expect(s).toContain("2026");
    expect(s).toContain("12");
  });
  it("null → dash", () => {
    expect(formatDateTimeId(null)).toBe("-");
  });
});
