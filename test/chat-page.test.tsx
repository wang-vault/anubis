import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ChatPage from "@/app/chat/page";

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

vi.mock("@/lib/supabase/browser", () => ({
  createAccountBrowserClient: () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: { id: "user-123" },
          },
        },
      }),
      onAuthStateChange: () => ({
        data: {
          subscription: {
            unsubscribe: vi.fn(),
          },
        },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { role: "admin" },
          }),
        }),
      }),
    }),
  }),
}));

describe("ChatPage Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merender state loading pemeriksaan auth saat SSR / initial render", () => {
    const html = renderToStaticMarkup(<ChatPage />);
    expect(html).toContain("Memeriksa sesi login…");
  });
});
