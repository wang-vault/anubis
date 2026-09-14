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
const loosePaymentMethod = (fallback: "YOBASEPAY" | "MANUAL") =>
  z.preprocess((v) => {
    if (typeof v !== "string") return fallback;
    const s = v.trim().toUpperCase();
    return s === "YOBASEPAY" || s === "MANUAL" ? s : fallback;
  }, z.enum(["YOBASEPAY", "MANUAL"]));

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
  // OPSIONAL: kosongkan bila QRIS otomatis belum aktif di akun YoBasePay.
  // Bila salah satu kosong → metode YOBASEPAY otomatis disembunyikan & webhook
  // ditolak (lihat yobasepayConfigured()). Pembayaran manual tetap jalan.
  YOBASEPAY_API_KEY: z.string().default(""),
  YOBASEPAY_WEBHOOK_SECRET: z.string().default(""),
  // Sesuai dokumentasi resmi: https://yobasepay.net/index.php?page=docs_public
  YOBASEPAY_BASE_URL: z.string().url().default("https://yobasepay.net/api"),
  // YoBasePay menambah "kode unik" (1–99 / 100–999) ke nominal agar mutasi
  // mudah dicocokkan. Toleransi validasi webhook terhadap nominal order.
  YOBASEPAY_AMOUNT_TOLERANCE: z.coerce.number().int().min(0).max(999).default(999),
  // expired_at dari YoBasePay berupa datetime tanpa zona waktu; diasumsikan WIB.
  YOBASEPAY_EXPIRY_TZ_OFFSET: z.string().default("+07:00"),
  // OPSIONAL: sebagian paket/versi API YoBasePay mengembalikan PAYLOAD QRIS
  // (string EMVCo) alih-alih gambar QR. Isi dengan template layanan pembuat
  // gambar QR yang kamu percaya — WAJIB https dan memuat placeholder {payload}:
  //   https://api.qrserver.com/v1/create-qr-code/?size=320x320&data={payload}
  // Kosongkan (default) bila provider mengirim gambar: nilai ini tidak dipakai.
  // Catatan: payload QRIS memuat nama merchant & nominal, jadi pertimbangkan
  // memakai layanan yang kamu host sendiri bila tidak ingin mengirimnya keluar.
  YOBASEPAY_QR_RENDER_URL: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim().length === 0 ? null : v.trim()) : (v ?? null)),
    z
      .union([
        z.null(),
        z
          .string()
          .url("URL renderer QR tidak valid")
          .startsWith("https://", "Renderer QR harus https")
          .max(500)
          .refine((v) => v.includes("{payload}"), "Template renderer QR harus memuat {payload}"),
      ])
      .default(null),
  ),

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
 * Helper: apakah QRIS otomatis (YoBasePay) bisa dipakai?
 * Butuh API key DAN webhook secret — tanpa secret, signature tidak bisa
 * diverifikasi sehingga webhook tidak boleh dipercaya sama sekali.
 */
export function yobasepayConfigured(env: Env = serverEnv()): boolean {
  return env.YOBASEPAY_API_KEY.length > 0 && env.YOBASEPAY_WEBHOOK_SECRET.length > 0;
}

/** Helper: apakah kredensial Telegram terisi? */
export function telegramConfigured(env: Env = serverEnv()): boolean {
  return env.TELEGRAM_BOT_TOKEN.length > 0 && env.TELEGRAM_CHAT_ID.length > 0;
}
