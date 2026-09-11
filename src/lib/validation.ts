import { z } from "zod";
import { normalizeWhatsapp } from "@/lib/phone";

/** Semua input user/API divalidasi dengan schema terpusat ini. */

export const whatsappSchema = z
  .string()
  .min(8)
  .max(20)
  .transform((v, ctx) => {
    const n = normalizeWhatsapp(v);
    if (!n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Nomor WhatsApp tidak valid. Gunakan nomor Indonesia, contoh 081234567890.",
      });
      return z.NEVER;
    }
    return n;
  });

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
