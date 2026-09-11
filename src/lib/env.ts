import { z } from "zod";

/**
 * Validasi environment variables SERVER-SIDE (terpusat, fail-fast).
 *
 * Public  : NEXT_PUBLIC_* → ikut ter-bundle ke browser, JANGAN isi rahasia.
 * Server  : tanpa prefix NEXT_PUBLIC → hanya bisa dibaca di server/Vercel.
 * Secret  : service role key, API key YoBasePay, webhook secret, bot token.
 *
 * Nilai tidak pernah dicetak ke output user; error hanya menyebut NAMA variabel.
 */
const schema = z.object({
  // --- Aplikasi ---
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .url()
    .default("http://localhost:3000"),
  NEXT_PUBLIC_SITE_NAME: z.string().min(1).max(60).default("Toko Saya"),

  // --- Supabase #1: ACCOUNT (auth + profil) ---
  NEXT_PUBLIC_SUPABASE_ACCOUNT_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ACCOUNT_ANON_KEY: z.string().min(10),
  SUPABASE_ACCOUNT_SERVICE_ROLE_KEY: z.string().min(10),

  // --- Supabase #2: STORE (produk + order + pembayaran) ---
  NEXT_PUBLIC_SUPABASE_STORE_URL: z.string().url(),
  // Opsional di MVP: semua akses toko berjalan server-side via service role.
  // Isi bila nanti ingin akses publik langsung dari client (RLS products READ).
  NEXT_PUBLIC_SUPABASE_STORE_ANON_KEY: z.string().optional().default(""),
  SUPABASE_STORE_SERVICE_ROLE_KEY: z.string().min(10),

  // --- YoBasePay (Payment Engine QRIS) ---
  YOBASEPAY_API_KEY: z.string().min(1),
  YOBASEPAY_WEBHOOK_SECRET: z.string().min(1),
  // Sesuai dokumentasi resmi: https://yobasepay.net/index.php?page=docs_public
  YOBASEPAY_BASE_URL: z.string().url().default("https://yobasepay.net/api"),
  // YoBasePay menambah "kode unik" (1–99 / 100–999) ke nominal agar mutasi
  // mudah dicocokkan. Toleransi validasi webhook terhadap nominal order.
  YOBASEPAY_AMOUNT_TOLERANCE: z.coerce.number().int().min(0).max(999).default(999),
  // expired_at dari YoBasePay berupa datetime tanpa zona waktu; diasumsikan WIB.
  YOBASEPAY_EXPIRY_TZ_OFFSET: z.string().default("+07:00"),

  // --- Telegram (NOTIFIKASI PENJUAL SAJA) ---
  // Opsional: bila kosong, notifikasi dilewati dengan log (pembayaran tetap diproses).
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_CHAT_ID: z.string().optional().default(""),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function serverEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(" | ");
    // Sengaja hanya untuk log developer internal (Vercel runtime logs),
    // bukan untuk ditampilkan ke pengunjung.
    throw new Error(
      `Konfigurasi environment tidak valid. Periksa Project Settings → Environment Variables di Vercel.\n${missing}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Helper: apakah kredensial Telegram terisi? */
export function telegramConfigured(env: Env = serverEnv()): boolean {
  return env.TELEGRAM_BOT_TOKEN.length > 0 && env.TELEGRAM_CHAT_ID.length > 0;
}
