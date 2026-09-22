import { z } from "zod";
import { normalizeWhatsapp } from "@/lib/phone";

/** Semua input user/API divalidasi dengan schema terpusat ini. */

/** Nomor WA → digit 62… ; pesan error bisa dikustomisasi pemanggil. */
function normalizeWhatsappField(v: string, ctx: z.RefinementCtx, message: string) {
  const n = normalizeWhatsapp(v);
  if (!n) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    return z.NEVER;
  }
  return n;
}

export const whatsappSchema = z
  .string()
  .min(8)
  .max(20)
  .transform((v, ctx) =>
    normalizeWhatsappField(
      v,
      ctx,
      "Nomor WhatsApp tidak valid. Gunakan nomor Indonesia, contoh 081234567890.",
    ),
  );

/** Nomor WA penjual (form /admin/settings) — wajib & harus valid. */
export const sellerWhatsappSchema = z
  .string()
  .min(1, "Nomor WhatsApp penjual wajib diisi.")
  .min(8, "Nomor WhatsApp penjual tidak valid. Contoh: 081234567890.")
  .max(20, "Nomor WhatsApp penjual terlalu panjang.")
  .transform((v, ctx) =>
    normalizeWhatsappField(
      v,
      ctx,
      "Nomor WhatsApp penjual tidak valid. Gunakan format 081234567890.",
    ),
  );

export const passwordSchema = z
  .string()
  .min(8, "Password minimal 8 karakter")
  .max(72, "Password maksimal 72 karakter");

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nama minimal 2 karakter")
    .max(80, "Nama maksimal 80 karakter"),
  email: z.string().trim().toLowerCase().email("Email tidak valid"),
  password: passwordSchema,
  whatsapp: whatsappSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email tidak valid"),
  password: z.string().min(1, "Password wajib diisi"),
});

export const emailSchema = z.string().trim().toLowerCase().email("Email tidak valid");

export const updateWhatsappSchema = z.object({ whatsapp: whatsappSchema });

export const checkoutSchema = z.object({
  productId: z.string().uuid("Produk tidak valid"),
  quantity: z.coerce
    .number()
    .int("Jumlah harus bilangan bulat")
    .min(1)
    .max(20, "Maksimal 20 pcs per order"),
});

/**
 * Klaim pembayaran manual: buyer menyatakan "sudah transfer" (biasanya setelah
 * berkoordinasi di WhatsApp) lalu mengisi nama pengirim / nomor referensi agar
 * penjual mudah mencocokkan mutasi.
 */
export const manualClaimSchema = z.object({
  orderCode: z.string().regex(/^ORD-\d{8}-[A-Z0-9]{6}$/, "Kode order tidak valid"),
  note: z.string().trim().max(200, "Catatan maksimal 200 karakter").default(""),
  reference: z.string().trim().max(60, "Nomor referensi maksimal 60 karakter").default(""),
});

export const orderCodeParamSchema = z.string().regex(
  /^ORD-\d{8}-[A-Z0-9]{6}$/,
  "Kode order tidak valid",
);

/**
 * Boolean dari JSON/form:
 * - true/false murni
 * - "true"/"false"/"1"/"0"/"on"/"off" (case-insensitive)
 * JANGAN pakai z.coerce.boolean() — Boolean("false") === true di JS.
 */
export const looseBooleanSchema = z.preprocess((val) => {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (["true", "1", "on", "yes"].includes(s)) return true;
    if (["false", "0", "off", "no", ""].includes(s)) return false;
  }
  return val;
}, z.boolean());

/** Pengaturan pembayaran manual via WhatsApp (form /admin/settings). */
export const manualSettingsSchema = z.object({
  is_enabled: looseBooleanSchema.default(true),
  whatsapp_number: sellerWhatsappSchema,
  label: z
    .string()
    .trim()
    .min(3, "Label minimal 3 karakter")
    .max(60, "Label maksimal 60 karakter")
    .default("Transfer Manual (WhatsApp)"),
  account_name: z.string().trim().max(80, "Nama penjual maksimal 80 karakter").default(""),
  instructions: z.string().trim().max(600, "Instruksi maksimal 600 karakter").default(""),
  whatsapp_message_template: z
    .string()
    .trim()
    .max(600, "Template pesan maksimal 600 karakter")
    .default(""),
  expiry_minutes: z.coerce
    .number()
    .int("Batas waktu harus bilangan bulat menit")
    .min(10, "Minimal 10 menit")
    .max(4320, "Maksimal 4320 menit (3 hari)")
    .default(120),
});

/** URL gambar opsional: kosong / spasi → null; selain itu wajib https. */
export const optionalHttpsUrlSchema = z.preprocess(
  (val) => {
    if (val === undefined || val === null) return null;
    if (typeof val !== "string") return val;
    const t = val.trim();
    return t.length === 0 ? null : t;
  },
  z
    .union([
      z.null(),
      z
        .string()
        .url("URL gambar tidak valid")
        .startsWith("https://", "Gambar harus https")
        .max(500),
    ])
    .default(null),
);

export const productInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(""),
  price: z.coerce
    .number()
    .int("Harga harus bilangan Rupiah penuh")
    .min(1000, "Harga minimal Rp1.000")
    .max(100_000_000, "Harga maksimal Rp100.000.000"),
  image_url: optionalHttpsUrlSchema,
  is_active: looseBooleanSchema.default(true),
});

export const productPatchSchema = productInputSchema.partial();

export const adminOrderActionSchema = z.object({
  action: z.enum(["process", "complete"]),
});

/**
 * Sanitasi kata kunci pencarian admin agar aman dipakai di filter PostgREST `.or()`.
 * Membuang metakarakter filter (%, _, koma, titik, kurung, backslash).
 */
export function sanitizeAdminSearchQuery(raw: string, maxLen = 80): string | null {
  const cleaned = raw
    .replace(/[%_,.()\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
  return cleaned.length >= 2 ? cleaned : null;
}
