import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi, HttpError, ErrorCodes, ok } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { requireUser } from "@/lib/authz";
import { storeDb } from "@/lib/supabase/server";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Endpoint OpenAI-compatible milik Groq. */
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
/** Model Groq yang dipakai untuk chat. */
const GROQ_MODEL = "qwen/qwen3.8-27b";

/** Maksimal pesan history yang ikut dikirim ke Groq. */
const MAX_HISTORY_MESSAGES = 10;
/** Maksimal karakter per pesan history yang ikut dikirim ke Groq. */
const MAX_HISTORY_CONTENT_CHARS = 1000;

/**
 * History dari client sengaja diterima longgar (role `system` dan konten panjang
 * tetap lolos validasi) karena sanitasinya dilakukan di server sebelum dikirim
 * ke Groq: pesan `system` dibuang, sisanya dipotong & dibatasi jumlahnya.
 */
const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

/** Bentuk pesan OpenAI-compatible yang dikirim ke Groq. */
interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const chatRequestSchema = z.object({
  message: z
    .string({
      required_error: "Pesan wajib diisi",
      invalid_type_error: "Pesan harus berupa teks",
    })
    .trim()
    .min(1, "Pesan tidak boleh kosong")
    .max(1000, "Pesan maksimal 1000 karakter"),
  history: z.array(chatMessageSchema).optional().default([]),
});

interface ChatOrderData {
  id: string;
  order_code: string;
  account_id: string;
  product_name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  total_amount: number;
  payment_status: string;
  order_status: string;
  buyer_name_snapshot: string;
  created_at: string;
}

/** Bentuk respons chat/completions Groq (OpenAI-compatible). */
interface GroqChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Ambil API key Groq dari env server. */
function groqApiKey(): string {
  const apiKey = (process.env.GROQ_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new HttpError(
      503,
      ErrorCodes.internal,
      "Layanan AI belum dikonfigurasi (GROQ_API_KEY).",
    );
  }
  return apiKey;
}

/**
 * Catat pemakaian token ke tabel `ai_usage` (Supabase Store, service role).
 * Error insert sengaja diabaikan — tracking tidak boleh menggagalkan chat.
 */
async function trackUsage(
  db: Awaited<ReturnType<typeof storeDb>>,
  usage: GroqChatResponse["usage"],
): Promise<void> {
  try {
    const { error } = await db.from("ai_usage").insert({
      provider: "groq",
      model: GROQ_MODEL,
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
    });
    if (error) {
      log.error("ai_usage_insert_failed", { message: error.message });
    }
  } catch (err) {
    log.errorFrom("ai_usage_insert_failed", err);
  }
}

/**
 * POST /api/chat
 * Endpoint AI Chat OpenAI-compatible via Groq API.
 * Didukung context injection produk aktif dan pesanan sesuai role user (customer/admin).
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handleApi(async () => {
    // 1. Cek session Supabase (wajib login, return 401 bila belum login)
    const ctx = await requireUser();
    const isAdmin = ctx.profile?.role === "admin";

    // 2. Rate limit: 20 req/IP per 60 detik
    const ip = clientIp(request.headers);
    const limit = rateLimit(`chat:${ip}`, 20, 60_000);
    if (!limit.ok) {
      throw new HttpError(
        429,
        ErrorCodes.tooManyRequests,
        `Terlalu banyak permintaan. Coba lagi dalam ${limit.retryAfterSec} detik.`,
      );
    }

    // 3. Validasi body request
    const body = await request.json();
    const { message, history } = chatRequestSchema.parse(body);

    // 4. Fetch data dari database Supabase Store
    const db = await storeDb();

    // Selalu fetch semua produk aktif
    const { data: activeProducts, error: prodErr } = await db
      .from("products")
      .select("id, name, description, price, image_url, is_active, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (prodErr) {
      log.error("chat_products_fetch_failed", { message: prodErr.message });
    }

    // Fetch pesanan sesuai role
    let ordersData: ChatOrderData[];

    if (isAdmin) {
      // Admin: fetch 20 pesanan terbaru
      const { data: adminOrders, error: ordErr } = await db
        .from("orders")
        .select(
          "id, order_code, account_id, product_name_snapshot, unit_price_snapshot, quantity, total_amount, payment_status, order_status, buyer_name_snapshot, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(20);

      if (ordErr) {
        log.error("chat_admin_orders_fetch_failed", { message: ordErr.message });
      }
      ordersData = (adminOrders as ChatOrderData[] | null) ?? [];
    } else {
      // Customer: fetch pesanan miliknya sendiri
      const { data: customerOrders, error: ordErr } = await db
        .from("orders")
        .select(
          "id, order_code, account_id, product_name_snapshot, unit_price_snapshot, quantity, total_amount, payment_status, order_status, buyer_name_snapshot, created_at",
        )
        .eq("account_id", ctx.user.id)
        .order("created_at", { ascending: false });

      if (ordErr) {
        log.error("chat_customer_orders_fetch_failed", { message: ordErr.message });
      }
      ordersData = (customerOrders as ChatOrderData[] | null) ?? [];
    }

    // 5. Format context untuk system prompt
    const productsContext =
      activeProducts && activeProducts.length > 0
        ? activeProducts
            .map(
              (p, i) =>
                `${i + 1}. [ID: ${p.id}] Nama: ${p.name}\n   Harga: Rp${Number(p.price).toLocaleString("id-ID")}\n   Deskripsi: ${p.description || "-"}\n   Status: Aktif`,
            )
            .join("\n\n")
        : "Tidak ada produk aktif saat ini.";

    const ordersContext = isAdmin
      ? ordersData.length > 0
        ? ordersData
            .map(
              (o, i) =>
                `${i + 1}. [Kode: ${o.order_code}] Pembeli: ${o.buyer_name_snapshot || "-"}\n   Akun ID: ${o.account_id}\n   Produk: ${o.product_name_snapshot} (${o.quantity} pcs @ Rp${Number(o.unit_price_snapshot).toLocaleString("id-ID")})\n   Total: Rp${Number(o.total_amount).toLocaleString("id-ID")}\n   Status Pembayaran: ${o.payment_status}\n   Status Pesanan: ${o.order_status}\n   Tanggal: ${o.created_at}`,
            )
            .join("\n\n")
        : "Belum ada data pesanan."
      : ordersData.length > 0
        ? ordersData
            .map(
              (o, i) =>
                `${i + 1}. [Kode: ${o.order_code}] Produk: ${o.product_name_snapshot} (${o.quantity} pcs @ Rp${Number(o.unit_price_snapshot).toLocaleString("id-ID")})\n   Total: Rp${Number(o.total_amount).toLocaleString("id-ID")}\n   Status Pembayaran: ${o.payment_status}\n   Status Pesanan: ${o.order_status}\n   Tanggal: ${o.created_at}`,
            )
            .join("\n\n")
        : "Customer ini belum memiliki pesanan.";

    // 6. Buat system prompt sesuai role
    const systemPrompt = isAdmin
      ? `Kamu adalah asisten admin Wang Hosting. Kamu bisa akses semua data produk dan pesanan. Jawab dalam Bahasa Indonesia dengan detail.

---
DATA KATALOG PRODUK AKTIF:
${productsContext}

---
DATA 20 PESANAN TERBARU:
${ordersContext}`
      : `Kamu adalah asisten toko Wang Hosting. Bantu customer dengan pertanyaan seputar produk dan status pesanan mereka. Jawab dalam Bahasa Indonesia. Jangan ungkapkan data pesanan customer lain.

---
DATA KATALOG PRODUK AKTIF:
${productsContext}

---
DATA PESANAN SAYA (Customer):
${ordersContext}`;

    // 7. Siapkan riwayat percakapan yang dikirim ke Groq.
    //    System prompt (berisi context produk/pesanan yang panjang) TIDAK pernah
    //    ikut ke dalam history — hanya dikirim sekali sebagai messages[0].
    //    History: hanya pesan user/assistant, maksimal 10 pesan terakhir,
    //    dan tiap pesan dipotong maksimal 1000 karakter agar payload tetap kecil.
    const sanitizedHistory: ChatCompletionMessage[] = (history ?? [])
      .filter(
        (h): h is { role: "user" | "assistant"; content: string } =>
          h.role === "user" || h.role === "assistant",
      )
      .slice(-MAX_HISTORY_MESSAGES)
      .map((h) => ({
        role: h.role,
        content: h.content.slice(0, MAX_HISTORY_CONTENT_CHARS),
      }));

    const messages: ChatCompletionMessage[] = [
      { role: "system", content: systemPrompt },
      ...sanitizedHistory,
      { role: "user", content: message },
    ];

    // 8. Kirim request ke Groq API (OpenAI-compatible)
    const apiKey = groqApiKey();
    let res: Response;
    try {
      res = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages,
          max_tokens: 1024,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err: unknown) {
      log.errorFrom("groq_fetch_failed", err);
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new HttpError(504, ErrorCodes.internal, "AI gateway timeout. Silakan coba lagi.");
      }
      throw new HttpError(
        502,
        ErrorCodes.internal,
        "Tidak bisa menghubungi server AI. Coba lagi beberapa saat.",
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      log.errorFrom(
        "groq_bad_status",
        new Error(`chat/completions → ${res.status} ${errText.slice(0, 500)}`),
      );
      if (res.status === 401 || res.status === 403) {
        throw new HttpError(
          502,
          ErrorCodes.internal,
          "Kredensial Groq ditolak. Periksa konfigurasi server.",
        );
      }
      throw new HttpError(
        502,
        ErrorCodes.internal,
        "Server Groq mengembalikan error. Coba lagi beberapa saat.",
      );
    }

    let jsonResponse: GroqChatResponse;
    try {
      jsonResponse = (await res.json()) as GroqChatResponse;
    } catch (err) {
      log.errorFrom("groq_invalid_json", err);
      throw new HttpError(502, ErrorCodes.internal, "Respons Groq tidak valid.");
    }

    // 9. Usage tracking ke tabel ai_usage (best-effort, error diabaikan)
    await trackUsage(db, jsonResponse.usage);

    const reply = jsonResponse.choices?.[0]?.message?.content ?? "";
    return { reply };
  }, (data) => ok(data));
}
