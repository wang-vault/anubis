import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;

const mockState = vi.hoisted(() => ({
  currentUser: null as { id: string; email?: string } | null,
  currentProfile: null as { role: string; name?: string } | null,
  products: [] as Row[],
  orders: [] as Row[],
  litellmResponse: {
    status: 200,
    body: {
      choices: [{ message: { content: "Halo! Ada yang bisa saya bantu?" } }],
    },
  },
  capturedFetchCalls: [] as { url: string; options?: RequestInit }[],
}));

vi.mock("@/lib/authz", () => ({
  requireUser: async () => {
    if (!mockState.currentUser) {
      const { HttpError, ErrorCodes } = await import("@/lib/api");
      throw new HttpError(401, ErrorCodes.unauthorized, "Silakan login terlebih dahulu.");
    }
    return {
      user: mockState.currentUser,
      session: { user: mockState.currentUser },
      profile: mockState.currentProfile,
      emailVerified: true,
    };
  },
  getAuthContext: async () => {
    if (!mockState.currentUser) return null;
    return {
      user: mockState.currentUser,
      session: { user: mockState.currentUser },
      profile: mockState.currentProfile,
      emailVerified: true,
    };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  storeDb: async () => ({
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let limitCount: number | null = null;
      let orderField: string | null = null;
      let orderAsc = false;

      const builder = {
        select(_cols?: string) {
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push((r) => r[col] === val);
          return builder;
        },
        order(field: string, opts?: { ascending?: boolean }) {
          orderField = field;
          orderAsc = opts?.ascending ?? true;
          return builder;
        },
        limit(n: number) {
          limitCount = n;
          return builder;
        },
        then(onfulfilled?: (val: unknown) => unknown, onrejected?: (err: unknown) => unknown) {
          const source = table === "products" ? mockState.products : mockState.orders;
          let filtered = source.filter((r) => filters.every((f) => f(r)));
          if (orderField) {
            filtered = [...filtered].sort((a, b) => {
              const va = String(a[orderField!] ?? "");
              const vb = String(b[orderField!] ?? "");
              return orderAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            });
          }
          if (limitCount !== null) {
            filtered = filtered.slice(0, limitCount);
          }
          return Promise.resolve({ data: filtered, error: null }).then(onfulfilled, onrejected);
        },
      };
      return builder;
    },
  }),
}));

describe("AI Chat API Route (POST /api/chat)", () => {
  beforeEach(() => {
    vi.stubEnv("LITELLM_API_URL", "https://litellm.example.com");
    vi.stubEnv("LITELLM_API_KEY", "sk-test-key-12345");
    mockState.currentUser = null;
    mockState.currentProfile = null;
    mockState.products = [];
    mockState.orders = [];
    mockState.capturedFetchCalls = [];
    mockState.litellmResponse = {
      status: 200,
      body: {
        choices: [{ message: { content: "Halo! Ada yang bisa saya bantu?" } }],
      },
    };

    global.fetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      mockState.capturedFetchCalls.push({ url: urlStr, options });

      return new Response(JSON.stringify(mockState.litellmResponse.body), {
        status: mockState.litellmResponse.status,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
  });

  const createRequest = (body: unknown, ip = "1.2.3.4") => {
    return new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    });
  };

  it("menolak user yang belum login dengan 401 UNAUTHORIZED", async () => {
    const { POST } = await import("@/app/api/chat/route");
    mockState.currentUser = null;

    const req = createRequest({ message: "Halo" });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error.code).toBe("UNAUTHORIZED");
  });

  it("validasi: menolak pesan kosong dengan 400 VALIDATION_ERROR", async () => {
    const { POST } = await import("@/app/api/chat/route");
    mockState.currentUser = { id: "user-123" };
    mockState.currentProfile = { role: "buyer", name: "Budi" };

    const req = createRequest({ message: "   " });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("validasi: menolak pesan lebih dari 1000 karakter dengan 400", async () => {
    const { POST } = await import("@/app/api/chat/route");
    mockState.currentUser = { id: "user-123" };
    mockState.currentProfile = { role: "buyer", name: "Budi" };

    const req = createRequest({ message: "a".repeat(1001) });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("rate limiting: membatasi lebih dari 20 request per menit dari IP yang sama (429)", async () => {
    const { POST } = await import("@/app/api/chat/route");
    mockState.currentUser = { id: "user-123" };
    mockState.currentProfile = { role: "buyer", name: "Budi" };

    const ip = "10.0.0.99";
    for (let i = 0; i < 20; i++) {
      const req = createRequest({ message: `Pesan ${i}` }, ip);
      const res = await POST(req);
      expect(res.status).toBe(200);
    }

    const req21 = createRequest({ message: "Pesan ke 21" }, ip);
    const res21 = await POST(req21);
    expect(res21.status).toBe(429);
  });

  it("customer: inject produk aktif dan hanya pesanan customer tersebut ke system prompt", async () => {
    const { POST } = await import("@/app/api/chat/route");
    mockState.currentUser = { id: "customer-1" };
    mockState.currentProfile = { role: "buyer", name: "John Customer" };

    mockState.products = [
      {
        id: "prod-1",
        name: "Hosting Murah",
        description: "Paket hosting cepat",
        price: 50000,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "prod-2",
        name: "Hosting Mati",
        description: "Tidak aktif",
        price: 90000,
        is_active: false,
        created_at: "2026-01-02T00:00:00Z",
      },
    ];

    mockState.orders = [
      {
        id: "ord-1",
        order_code: "ORD-001",
        account_id: "customer-1",
        product_name_snapshot: "Hosting Murah",
        unit_price_snapshot: 50000,
        quantity: 1,
        total_amount: 50000,
        payment_status: "PAID",
        order_status: "DONE",
        buyer_name_snapshot: "John Customer",
        created_at: "2026-01-03T00:00:00Z",
      },
      {
        id: "ord-2",
        order_code: "ORD-002",
        account_id: "other-customer-2",
        product_name_snapshot: "VPS Pro",
        unit_price_snapshot: 200000,
        quantity: 1,
        total_amount: 200000,
        payment_status: "PAID",
        order_status: "DONE",
        buyer_name_snapshot: "Other Guy",
        created_at: "2026-01-04T00:00:00Z",
      },
    ];

    const req = createRequest(
      {
        message: "Cek pesanan saya",
        history: [
          { role: "user", content: "Halo" },
          { role: "assistant", content: "Halo juga" },
        ],
      },
      "192.168.1.1",
    );

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.reply).toBe("Halo! Ada yang bisa saya bantu?");

    expect(mockState.capturedFetchCalls.length).toBe(1);
    const call = mockState.capturedFetchCalls[0]!;
    expect(call.url).toBe("https://litellm.example.com/chat/completions");
    expect(call.options?.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test-key-12345",
    });

    const parsedBody = JSON.parse(call.options?.body as string);
    expect(parsedBody.model).toBe("nvidia-llama");
    expect(parsedBody.max_tokens).toBe(1024);
    expect(parsedBody.temperature).toBe(0.3);

    const systemPrompt = parsedBody.messages[0].content;
    expect(systemPrompt).toContain("Kamu adalah asisten toko Wang Hosting");
    expect(systemPrompt).toContain("Hosting Murah");
    expect(systemPrompt).not.toContain("Hosting Mati"); // Is inactive
    expect(systemPrompt).toContain("ORD-001");
    expect(systemPrompt).not.toContain("ORD-002"); // Belongs to other customer!
  });

  it("admin: inject produk aktif dan 20 pesanan terbaru ke admin system prompt", async () => {
    const { POST } = await import("@/app/api/chat/route");
    mockState.currentUser = { id: "admin-id" };
    mockState.currentProfile = { role: "admin", name: "Admin Wang" };

    mockState.products = [
      {
        id: "prod-1",
        name: "Hosting Murah",
        description: "Paket hosting cepat",
        price: 50000,
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];

    mockState.orders = [
      {
        id: "ord-1",
        order_code: "ORD-001",
        account_id: "cust-1",
        product_name_snapshot: "Hosting Murah",
        unit_price_snapshot: 50000,
        quantity: 1,
        total_amount: 50000,
        payment_status: "PAID",
        order_status: "PROCESSING",
        buyer_name_snapshot: "User One",
        created_at: "2026-01-03T00:00:00Z",
      },
      {
        id: "ord-2",
        order_code: "ORD-002",
        account_id: "cust-2",
        product_name_snapshot: "Hosting Murah",
        unit_price_snapshot: 50000,
        quantity: 2,
        total_amount: 100000,
        payment_status: "PENDING",
        order_status: "PENDING",
        buyer_name_snapshot: "User Two",
        created_at: "2026-01-04T00:00:00Z",
      },
    ];

    const req = createRequest({ message: "Rekap order terbaru" }, "192.168.1.2");
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);

    const call = mockState.capturedFetchCalls[0]!;
    const parsedBody = JSON.parse(call.options?.body as string);
    const systemPrompt = parsedBody.messages[0].content;

    expect(systemPrompt).toContain("Kamu adalah asisten admin Wang Hosting");
    expect(systemPrompt).toContain("ORD-001");
    expect(systemPrompt).toContain("ORD-002");
    expect(systemPrompt).toContain("User One");
    expect(systemPrompt).toContain("User Two");
  });

  it("menangani error LiteLLM jika upstream mengembalikan 500", async () => {
    const { POST } = await import("@/app/api/chat/route");
    mockState.currentUser = { id: "user-123" };
    mockState.currentProfile = { role: "buyer", name: "Budi" };
    mockState.litellmResponse = {
      status: 500,
      body: { error: "Internal LLM Server Error" } as any,
    };

    const req = createRequest({ message: "Halo" }, "192.168.1.3");
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.error.message).toContain("Server LiteLLM mengembalikan error");
  });
});
