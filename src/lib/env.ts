import { z } from "zod";

/**
 * Validasi environment variables SERVER-SIDE (terpusat, fail-fast).
 *
 * Public  : NEXT_PUBLIC_* → ikut ter-bundle ke browser, JANGAN isi rahasia.
 * Server  : tanpa prefix NEXT_PUBLIC → hanya bisa dibaca di server/Vercel.
 * Secret  : service role key Supabase, bot token Telegram.
 *
 * Catatan pembayaran (2026-09): metode QRIS otomatis (provider + webhook)
 * SUDAH DIHAPUS dari kode. Satu-satunya metode bayar adalah transfer manual
 * yang dikoordinasikan lewat WhatsApp, jadi tidak ada lagi env provider
 * (STENLY_*) maupun URL gambar QR.
 *
 * Nilai tidak pernah dicetak ke output user; error hanya menyebut NAMA variabel.
 */
/**
 * Boolean dari env: menerima "1"/"true"/"yes"/"on" (case-insensitive) sebagai
 * true; string kosong TIDAK diartikan true (berbeda dari Boolean("false")).
 */
const looseBool = (fallback: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === null) return fallback;
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(s)) return true;
      if (["", "0", "false", "no", "off"].includes(s)) return false;
    }
    // Nilai tak dikenal (mis. "ya") JANGAN melempar: serverEnv() dipanggil oleh
    // supabase/server.ts, jadi satu salah ketik pada preferensi pembayaran akan
    // menjatuhkan SELURUH situs (katalog & login ikut 500) — bukan hanya
    // checkout. Untuk nilai preferensi, jatuh ke default jauh lebih aman
    // daripada fail-fast. Kredensial di bawah tetap wajib & tetap fail-fast.
    return fallback;
  }, z.boolean());

/** String opsional: undefined/null → "" (tidak pernah melempar). */
const optionalString = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : ""),
  z.string(),
);

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

  // --- Pembayaran MANUAL via WhatsApp (satu-satunya metode bayar) ---
  // Saklar utama. `false` = checkout menampilkan "pembayaran belum tersedia".
  MANUAL_PAYMENT_ENABLED: looseBool(true).default(true),
  // CADANGAN nomor WhatsApp penjual. Sumber utama = kolom
  // `manual_payment_settings.whatsapp_number` yang diisi dari /admin/settings
  // (bisa diubah tanpa deploy). Env ini dipakai bila kolomnya masih kosong.
  WHATSAPP_SELLER_NUMBER: optionalString.default(""),

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
