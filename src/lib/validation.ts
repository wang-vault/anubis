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

export const productInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(""),
  price: z.coerce
    .number()
    .int("Harga harus bilangan Rupiah penuh")
    .min(1000, "Harga minimal Rp1.000")
    .max(100_000_000, "Harga maksimal Rp100.000.000"),
  image_url: z
    .string()
    .trim()
    .url("URL gambar tidak valid")
    .startsWith("https://", "Gambar harus https")
    .max(500)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  is_active: z.coerce.boolean().default(true),
});

export const productPatchSchema = productInputSchema.partial();

export const adminOrderActionSchema = z.object({
  action: z.enum(["process", "complete"]),
});
