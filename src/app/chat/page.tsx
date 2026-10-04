"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAccountBrowserClient } from "@/lib/supabase/browser";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
  createdAt: number;
}

const SUGGESTIONS = [
  "Produk apa saja yang tersedia?",
  "Berapa harga produk dan apa spesifikasinya?",
  "Cek status pesanan saya",
  "Bagaimana cara pembayaran manual?",
];

export default function ChatPage() {
  const router = useRouter();
  const supabase = createAccountBrowserClient();

  const [authChecking, setAuthChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Periksa autentikasi user di browser
  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!session) {
        router.replace("/auth/login?next=/chat");
        return;
      }

      // Ambil profil user untuk cek role admin
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle();

      if (mounted) {
        setIsAdmin(profile?.role === "admin");
        setAuthChecking(false);
      }
    }

    void checkAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/auth/login?next=/chat");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  // Scroll otomatis ke pesan terbaru
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  // Hapus percakapan
  const handleClearHistory = () => {
    setMessages([]);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  // Kirim pesan ke API
  const handleSend = async (messageToSend?: string) => {
    const text = (messageToSend ?? input).trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}-${Math.random()}`,
      role: "user",
      content: text,
      createdAt: Date.now(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    // Ambil maksimal 20 percakapan terakhir (tanpa pesan error)
    const historyPayload = newMessages
      .filter((m) => !m.isError)
      .slice(-20)
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
          history: historyPayload.slice(0, -1), // Riwayat sebelum pesan baru
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || !data.ok) {
        const errorText =
          data?.error?.message ??
          "Terjadi kesalahan saat memproses pertanyaan kamu. Silakan coba lagi.";

        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `⚠️ Error: ${errorText}`,
            isError: true,
            createdAt: Date.now(),
          },
        ]);
        return;
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.reply || "Tidak ada jawaban.",
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: "⚠️ Gagal terhubung ke server. Periksa koneksi internet kamu.",
          isError: true,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (authChecking) {
    return (
      <div className="container-x mx-auto max-w-4xl py-12 text-center">
        <div className="card p-8">
          <p className="font-serif text-lg text-slate-600">Memeriksa sesi login…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container-x mx-auto max-w-4xl space-y-4 py-4 sm:py-6">
      {/* Header */}
      <div className="paper-heading flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Layanan Pelanggan · Wang Hosting</p>
          <h1 className="paper-heading-title font-serif">AI Chat</h1>
          <p className="mt-1 text-sm text-slate-500">
            Tanyakan informasi katalog produk dan status pesanan kamu.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Link
              href="/admin/ai-usage"
              className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
              title="Lihat statistik pemakaian token dan biaya AI"
            >
              <span>📊</span>
              <span>Monitoring Token AI</span>
            </Link>
          )}

          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClearHistory}
              disabled={loading}
              className="btn btn-secondary btn-sm"
            >
              Hapus percakapan
            </button>
          )}
        </div>
      </div>

      {/* Chat Container */}
      <div className="card flex h-[68dvh] min-h-[460px] flex-col overflow-hidden">
        {/* Messages List */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="max-w-md space-y-3">
                <span className="inline-block text-3xl" aria-hidden>
                  💬
                </span>
                <h2 className="font-serif text-lg font-bold">
                  Selamat datang di AI Chat!
                </h2>
                <p className="text-xs text-slate-500 sm:text-sm">
                  {isAdmin
                    ? "Sebagai Admin, Anda dapat menanyakan katalog produk aktif, ringkasan 20 pesanan terbaru, dan informasi toko."
                    : "Asisten kami siap membantu Anda seputar produk yang tersedia dan status pesanan milik Anda."}
                </p>

                <div className="mt-4 flex flex-col gap-2 pt-2 text-left">
                  <p className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                    Contoh Pertanyaan:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => void handleSend(s)}
                        className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-brand-600 hover:text-brand-700"
                      >
                        {s} →
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${
                  m.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[88%] sm:max-w-[78%] rounded-sm p-3.5 text-sm shadow-xs ${
                    m.role === "user"
                      ? "bg-brand-700 text-white"
                      : m.isError
                        ? "alert-error border-red-300"
                        : "border border-slate-300 bg-white text-slate-900"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-3 text-[11px] opacity-80">
                    <span className="font-bold">
                      {m.role === "user"
                        ? "Kamu"
                        : isAdmin
                          ? "Asisten Admin"
                          : "Asisten Wang Hosting"}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap break-words leading-relaxed">
                    {m.content}
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Loading Indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-sm border border-slate-300 bg-white p-3.5 text-sm shadow-xs text-slate-700">
                <div className="mb-1 text-[11px] font-bold text-slate-500">
                  {isAdmin ? "Asisten Admin" : "Asisten Wang Hosting"}
                </div>
                <div className="flex items-center gap-1.5 py-1">
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-slate-500"></span>
                  <span
                    className="inline-block h-2 w-2 animate-bounce rounded-full bg-slate-500"
                    style={{ animationDelay: "150ms" }}
                  ></span>
                  <span
                    className="inline-block h-2 w-2 animate-bounce rounded-full bg-slate-500"
                    style={{ animationDelay: "300ms" }}
                  ></span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-slate-300 bg-slate-50 p-3 sm:p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
            className="flex items-end gap-2"
          >
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                maxLength={1000}
                placeholder="Tulis pesan kamu di sini… (Tekan Enter untuk kirim, Shift+Enter untuk baris baru)"
                disabled={loading}
                className="input resize-none py-2 text-sm"
              />
              <div className="mt-1 flex justify-between text-[11px] text-slate-400">
                <span>Enter = Kirim · Shift+Enter = Baris baru</span>
                <span>{input.length}/1000</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="btn btn-primary self-start px-4 py-2.5 text-sm"
            >
              {loading ? "Mengirim…" : "Kirim"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
