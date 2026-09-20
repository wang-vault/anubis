import { z } from "zod";

/**
 * Validasi environment variables SERVER-SIDE (terpusat, fail-fast).
 *
 * Public  : NEXT_PUBLIC_* → ikut ter-bundle ke browser, JANGAN isi rahasia.
 * Server  : tanpa prefix NEXT_PUBLIC → hanya bisa dibaca di server/Vercel.
 * Secret  : service role key, secret key Stenly, webhook secret, bot token.
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

/**
 * Enum yang toleran terhadap kapitalisasi & spasi ("manual", " MANUAL " → MANUAL).
 * Nilai tak dikenal jatuh ke default, dengan alasan yang sama seperti looseBool:
 * ini preferensi, bukan kredensial — tidak boleh menjatuhkan situs.
 */
const loosePaymentMethod = (fallback: "STENLY" | "MANUAL") =>
  z.preprocess((v) => {
    if (typeof v !== "string") return fallback;
    const s = v.trim().toUpperCase();
    if (s === "STENLY" || s === "MANUAL") return s;
    // Kompatibilitas konfigurasi lama: nilai env YOBASEPAY (provider otomatis
    // sebelumnya) tetap diartikan "QRIS otomatis" agar deployment yang belum
    // memperbarui env tidak tiba-tiba berpindah ke pembayaran manual.
    if (s === "YOBASEPAY" || s === "AUTO") return "STENLY";
    return fallback;
  }, z.enum(["STENLY", "MANUAL"]));

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

  // --- STENLY (StenlyPay — payment gateway QRIS otomatis) ---
  // OPSIONAL: kosongkan bila QRIS otomatis belum aktif di akun Stenly.
  // Bila salah satu kosong → metode STENLY otomatis disembunyikan & webhook
  // ditolak (lihat stenlyConfigured()). Pembayaran manual tetap jalan.
  //
  // Dokumentasi resmi: https://stenly.id/docs
  //   Secret key  : sk_live_… / sk_test_…  (header `x-api-key`, server-only)
  //   Webhook sec.: whsec_…                (HMAC-SHA256 atas raw body)
  STENLY_API_KEY: z.string().default(""),
  STENLY_WEBHOOK_SECRET: z.string().default(""),
  // Base URL REST API. Endpoint yang dipakai: POST {BASE}/api/v1/charge,
  // GET {BASE}/api/v1/status/:order_id (lihat docs §Autentikasi & Endpoint).
  STENLY_BASE_URL: z.string().url().default("https://stenly.id"),
  // Masa aktif QRIS dalam menit (docs: parameter opsional `expiry_minutes`,
  // default provider 15 menit). Dipakai apa adanya saat create charge.
  STENLY_EXPIRY_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

  // --- Pembayaran MANUAL (QRIS statis milik penjual, mis. QR GoPay Merchant) ---
  // Metode ini tidak butuh provider: buyer scan QR statis, transfer, lalu
  // menekan "Saya sudah transfer"; penjual memverifikasi mutasi di dashboard.
  MANUAL_PAYMENT_ENABLED: looseBool(true).default(true),
  // Metode default yang dipilih di halaman checkout.
  DEFAULT_PAYMENT_METHOD: loosePaymentMethod("MANUAL").default("MANUAL"),
  // Opsional: bila kamu sudah meng-host gambar QR sendiri (https), URL ini
  // mengalahkan gambar yang di-upload dari /admin/settings.
  MANUAL_PAYMENT_QR_IMAGE_URL: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim().length === 0 ? null : v.trim()) : (v ?? null)),
    z
      .union([
        z.null(),
        z.string().url("URL gambar QR tidak valid").startsWith("https://", "Gambar QR harus https").max(500),
      ])
      .default(null),
  ),

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

/**
 * Helper: apakah QRIS otomatis (Stenly) bisa dipakai?
 * Butuh secret key DAN webhook secret — tanpa webhook secret, signature tidak
 * bisa diverifikasi sehingga webhook tidak boleh dipercaya sama sekali.
 */
export function stenlyConfigured(env: Env = serverEnv()): boolean {
  return env.STENLY_API_KEY.length > 0 && env.STENLY_WEBHOOK_SECRET.length > 0;
}

/** true bila kredensial Stenly memakai key sandbox (`sk_test_…`). */
export function stenlyIsSandbox(env: Env = serverEnv()): boolean {
  return env.STENLY_API_KEY.startsWith("sk_test_");
}

/** Helper: apakah kredensial Telegram terisi? */
export function telegramConfigured(env: Env = serverEnv()): boolean {
  return env.TELEGRAM_BOT_TOKEN.length > 0 && env.TELEGRAM_CHAT_ID.length > 0;
}
