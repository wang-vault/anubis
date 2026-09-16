/**
 * Banner "database perlu dimigrasi" harus benar-benar ter-render berisi SQL
 * perbaikannya — inilah yang dilihat penjual ketika /admin tidak lagi mati
 * total karena kolom pembayaran manual belum ada.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ db: null }));
vi.mock("@/lib/supabase/server", () => ({ storeDb: async () => h.db }));

import { SchemaMigrationNotice } from "@/components/admin/SchemaMigrationNotice";
import { MANUAL_ORDER_COLUMNS, type StoreSchemaCheck } from "@/lib/store-schema";

function check(overrides: Partial<StoreSchemaCheck> = {}): StoreSchemaCheck {
  return {
    ready: false,
    reason: "missing_column",
    message: "column orders.payment_method does not exist",
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("SchemaMigrationNotice", () => {
  it("menampilkan SQL migrasi lengkap + pesan error dari database", () => {
    const html = renderToStaticMarkup(<SchemaMigrationNotice check={check()} />);

    for (const col of MANUAL_ORDER_COLUMNS) {
      expect(html, `SQL di banner tidak menambahkan kolom ${col}`).toContain(
        `add column if not exists ${col}`,
      );
    }
    expect(html).toContain("manual_payment_settings");
    expect(html).toContain("column orders.payment_method does not exist");
    expect(html).toContain("supabase/store/002_manual_payment.sql");
    // penjual tidak perlu redeploy
    expect(html).toContain("tidak perlu redeploy");
  });

  it("kasus tabel belum ada diarahkan ke 001_schema.sql", () => {
    const html = renderToStaticMarkup(
      <SchemaMigrationNotice check={check({ reason: "missing_table", message: null })} />,
    );

    expect(html).toContain("supabase/store/001_schema.sql");
    expect(html).toContain("Tabel toko belum ada");
  });

  it("tetap ter-render tanpa pesan error (message null)", () => {
    const html = renderToStaticMarkup(<SchemaMigrationNotice check={check({ message: null })} />);
    expect(html).toContain("Database toko belum dimigrasi");
  });
});
