/**
 * Hapus produk admin: tidak ada pesanan aktif → terhapus; pesanan yang
 * statusnya bukan cancelled/refunded → 409; route menolak non-admin & UUID palsu.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { HttpError } from "@/lib/api";

const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  deleteError: null as { message: string; code?: string } | null,
  forbid: false,
}));

function createDb() {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let op: "select" | "delete" = "select";
      let head = false;
      const builder = {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          head = Boolean(opts?.head);
          return builder;
        },
        eq(col: string, value: unknown) {
          filters.push((row) => String(row[col]) === String(value));
          return builder;
        },
        not(col: string, operator: string, value: unknown) {
          if (operator === "ilike") {
            const needle = String(value).toLowerCase();
            filters.push((row) => String(row[col] ?? "").toLowerCase() !== needle);
          }
          return builder;
        },
        delete() {
          op = "delete";
          return builder;
        },
        async maybeSingle() {
          const rows = (h.tables[table] ?? []).filter((row) => filters.every((fn) => fn(row)));
          return { data: rows[0] ?? null, error: null };
        },
        then(
          onfulfilled?: ((value: unknown) => unknown) | null,
          onrejected?: ((reason: unknown) => unknown) | null,
        ) {
          const matched = (h.tables[table] ?? []).filter((row) => filters.every((fn) => fn(row)));
          if (op === "delete") {
            if (h.deleteError) {
              return Promise.resolve({ data: null, error: h.deleteError }).then(onfulfilled, onrejected);
            }
            h.tables[table] = (h.tables[table] ?? []).filter((row) => !filters.every((fn) => fn(row)));
            return Promise.resolve({ data: matched, error: null }).then(onfulfilled, onrejected);
          }
          return Promise.resolve({
            data: head ? null : matched,
            error: null,
            count: matched.length,
          }).then(onfulfilled, onrejected);
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  storeDb: async () => createDb(),
}));

vi.mock("@/lib/authz", async () => {
  const { HttpError: GuardError, ErrorCodes } = await import("@/lib/api");
  return {
    requireAdmin: async () => {
      if (h.forbid) {
        throw new GuardError(403, ErrorCodes.forbidden, "Akses ditolak: area khusus penjual/admin.");
      }
      return { user: { id: "admin" }, profile: { role: "admin" } };
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

import { revalidatePath, revalidateTag } from "next/cache";
import { PRODUCT_DELETE_BLOCKED_MESSAGE, adminDeleteProduct } from "@/lib/products";
import { DELETE } from "@/app/api/admin/products/[id]/route";

function product(id = PRODUCT_ID): Row {
  return {
    id,
    name: "Kopi Gayo",
    description: "",
    price: 25000,
    image_url: null,
    is_active: true,
  };
}

function order(status: string, id = "44444444-4444-4444-8444-444444444444"): Row {
  return { id, product_id: PRODUCT_ID, order_status: status };
}

beforeEach(() => {
  h.tables = { products: [product()], orders: [] };
  h.deleteError = null;
  h.forbid = false;
  vi.mocked(revalidateTag).mockClear();
  vi.mocked(revalidatePath).mockClear();
});

describe("adminDeleteProduct", () => {
  it("menghapus produk yang tidak punya pesanan dan mengosongkan cache katalog", async () => {
    await adminDeleteProduct(PRODUCT_ID);

    expect(h.tables.products).toEqual([]);
    expect(revalidateTag).toHaveBeenCalledWith("products");
    expect(revalidatePath).toHaveBeenCalledWith("/products");
  });

  it.each(["PENDING", "PAID", "PROCESSING", "DONE", "EXPIRED"])(
    "menolak 409 bila ada pesanan status %s",
    async (status) => {
      h.tables.orders = [order(status)];

      await expect(adminDeleteProduct(PRODUCT_ID)).rejects.toMatchObject({
        status: 409,
        message: PRODUCT_DELETE_BLOCKED_MESSAGE,
      });
      expect(h.tables.products).toHaveLength(1);
      expect(revalidateTag).not.toHaveBeenCalled();
    },
  );

  it.each(["cancelled", "refunded", "CANCELLED", "REFUNDED", "Cancelled"])(
    "mengizinkan penghapusan bila satu-satunya pesanan berstatus %s",
    async (status) => {
      h.tables.orders = [order(status)];

      await adminDeleteProduct(PRODUCT_ID);

      expect(h.tables.products).toEqual([]);
    },
  );

  it("tetap menolak bila ada pesanan aktif di samping yang sudah cancelled", async () => {
    h.tables.orders = [
      order("cancelled", "44444444-4444-4444-8444-444444444441"),
      order("PAID", "44444444-4444-4444-8444-444444444442"),
    ];

    await expect(adminDeleteProduct(PRODUCT_ID)).rejects.toBeInstanceOf(HttpError);
    expect(h.tables.products).toHaveLength(1);
  });

  it("tidak terpengaruh pesanan produk lain", async () => {
    h.tables.orders = [{ ...order("PENDING"), product_id: "55555555-5555-4555-8555-555555555555" }];

    await adminDeleteProduct(PRODUCT_ID);

    expect(h.tables.products).toEqual([]);
  });

  it("404 bila produk tidak ada", async () => {
    h.tables.products = [];

    await expect(adminDeleteProduct(PRODUCT_ID)).rejects.toMatchObject({
      status: 404,
      message: "Produk tidak ditemukan.",
    });
  });

  it("pelanggaran FK (balapan) menjadi 409, bukan 500", async () => {
    h.deleteError = {
      code: "23503",
      message: 'update or delete on table "products" violates foreign key constraint',
    };

    await expect(adminDeleteProduct(PRODUCT_ID)).rejects.toMatchObject({
      status: 409,
      message: PRODUCT_DELETE_BLOCKED_MESSAGE,
    });
    expect(h.tables.products).toHaveLength(1);
  });
});

describe("DELETE /api/admin/products/[id]", () => {
  function call(id: string) {
    return DELETE(new NextRequest(`http://localhost/api/admin/products/${id}`), {
      params: Promise.resolve({ id }),
    });
  }

  it("200 { ok, deleted: true } bila berhasil", async () => {
    const res = await call(PRODUCT_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: true });
    expect(h.tables.products).toEqual([]);
  });

  it("400 bila id bukan UUID", async () => {
    const res = await call("bukan-uuid");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe("ID produk tidak valid.");
    expect(h.tables.products).toHaveLength(1);
  });

  it("409 dengan pesan pesanan aktif", async () => {
    h.tables.orders = [order("PROCESSING")];
    const res = await call(PRODUCT_ID);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "CONFLICT", message: PRODUCT_DELETE_BLOCKED_MESSAGE },
    });
  });

  it("404 bila produk tidak ada", async () => {
    h.tables.products = [];
    const res = await call(PRODUCT_ID);
    expect(res.status).toBe(404);
  });

  it("403 bila bukan admin — tidak menyentuh katalog", async () => {
    h.forbid = true;
    const res = await call(PRODUCT_ID);
    expect(res.status).toBe(403);
    expect(h.tables.products).toHaveLength(1);
  });
});
