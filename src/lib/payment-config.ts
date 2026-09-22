import "server-only";
import { ErrorCodes, HttpError } from "@/lib/api";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { storeDb } from "@/lib/supabase/server";
import { MANUAL_PAYMENT_MIGRATION_FILE, checkStoreSchema } from "@/lib/store-schema";
import {
  PAYMENT_METHOD_MANUAL,
  isManualMethod,
  type AvailablePaymentMethod,
  type PaymentMethod,
} from "@/lib/payment-methods";
import { formatWhatsappDisplay, normalizeWhatsapp } from "@/lib/phone";
import { DEFAULT_PAYMENT_MESSAGE_TEMPLATE } from "@/lib/whatsapp";

/**
 * ===========================================================================
 * KONFIGURASI PEMBAYARAN MANUAL VIA WHATSAPP (server-side)
 * ===========================================================================
 * Sumber konfigurasi = tabel `manual_payment_settings` (Supabase #2) + env
 * opsional. Di-edit penjual lewat /admin/settings tanpa perlu deploy ulang.
 *
 * Isi pengaturan:
 *  - whatsapp_number          : nomor WhatsApp penjual (tujuan chat buyer).
 *  - whatsapp_message_template: pesan yang sudah terisi saat buyer membuka chat.
 *  - label / account_name     : nama metode & nama penjual yang tampil di UI.
 *  - instructions             : instruksi tambahan (opsional) untuk buyer.
 *  - expiry_minutes           : batas waktu bayar sebelum order kadaluarsa.
 *
 * TIDAK ADA lagi gambar QR / kredensial provider: detail pembayaran (QRIS
 * statis, nomor rekening, atau e-wallet) dikirim penjual langsung di chat
 * WhatsApp, sehingga selalu bisa diperbarui tanpa menyentuh aplikasi.
 */

/** Label default bila penjual belum mengubahnya. */
export const MANUAL_DEFAULT_LABEL = "Transfer Manual (WhatsApp)";
/** Instruksi default yang tampil di halaman pembayaran buyer. */
export const MANUAL_DEFAULT_INSTRUCTIONS =
  "Detail pembayaran (QRIS / rekening / e-wallet) dikirim penjual lewat chat WhatsApp.";
/** Batas panjang instruksi & template pesan (dijaga validation.ts juga). */
export const MANUAL_TEXT_MAX = 600;

export interface ManualSettingsRow {
  id: number;
  is_enabled: boolean;
  label: string;
  account_name: string;
  instructions: string;
  expiry_minutes: number;
  whatsapp_number: string;
  whatsapp_message_template: string;
  updated_at: string;
}

/** Ringkasan aman untuk UI (tanpa data rahasia — nomor WA memang publik). */
export interface ManualPaymentView {
  /** Metode bisa dipakai buyer? (enabled + nomor WA valid + skema siap) */
  available: boolean;
  /** Kolom pembayaran manual ada di database (migrasi 002 & 004 sudah jalan). */
  schemaReady: boolean;
  /** Kenapa tidak tersedia — untuk pesan di dashboard admin. */
  reason: "disabled" | "no_whatsapp" | "schema_missing" | null;
  /** Saklar di DB (form /admin/settings). */
  isEnabled: boolean;
  /** Saklar env MANUAL_PAYMENT_ENABLED. */
  envEnabled: boolean;
  /** Nomor WA dari DB diisi? (kalau tidak, env WHATSAPP_SELLER_NUMBER dipakai) */
  numberFromDatabase: boolean;
  label: string;
  sellerName: string;
  instructions: string;
  expiryMinutes: number;
  /** Nomor ternormalisasi (62…) atau null bila belum diatur/tidak valid. */
  whatsappNumber: string | null;
  /** Nomor siap tampil (+62 …) atau null. */
  whatsappDisplay: string | null;
  /** Template pesan buyer → penjual (default dipakai bila kosong). */
  messageTemplate: string;
  updatedAt: string | null;
}

const SETTINGS_SELECT =
  "id,is_enabled,label,account_name,instructions,expiry_minutes,whatsapp_number,whatsapp_message_template,updated_at";

export async function getManualPaymentSettings(): Promise<ManualSettingsRow | null> {
  const db = await storeDb();
  const { data, error } = await db
    .from("manual_payment_settings")
    .select(SETTINGS_SELECT)
    .eq("id", 1)
    .maybeSingle<ManualSettingsRow>();
  if (error) {
    // Tabel/kolom belum di-migrate → jangan jatuhkan seluruh app; metode
    // manual dianggap belum dikonfigurasi dan banner /admin menjelaskan
    // migrasi yang harus dijalankan.
    log.error("manual_settings_fetch_failed", { message: error.message });
    return null;
  }
  return data;
}

/** Nomor WA efektif: kolom DB lebih diutamakan, env hanya cadangan. */
export function resolveSellerNumber(
  row: ManualSettingsRow | null,
  fallbackFromEnv: string,
): { number: string | null; fromDatabase: boolean } {
  const fromDb = row?.whatsapp_number?.trim() ?? "";
  const raw = fromDb || fallbackFromEnv.trim();
  return { number: raw ? normalizeWhatsapp(raw) : null, fromDatabase: fromDb.length > 0 };
}

export async function getManualPaymentView(): Promise<ManualPaymentView> {
  const env = serverEnv();
  const [row, schema] = await Promise.all([getManualPaymentSettings(), checkStoreSchema()]);

  const label = row?.label?.trim() || MANUAL_DEFAULT_LABEL;
  const sellerName = row?.account_name ?? "";
  const instructions = row?.instructions?.trim() || MANUAL_DEFAULT_INSTRUCTIONS;
  const expiryMinutes = row?.expiry_minutes ?? 120;
  const messageTemplate = row?.whatsapp_message_template?.trim() || DEFAULT_PAYMENT_MESSAGE_TEMPLATE;

  const { number: whatsappNumber, fromDatabase } = resolveSellerNumber(
    row,
    env.WHATSAPP_SELLER_NUMBER,
  );

  const isEnabled = row?.is_enabled ?? false;
  const envEnabled = env.MANUAL_PAYMENT_ENABLED;
  const enabled = envEnabled && isEnabled;
  // Kolom pembayaran manual (payment_method, manual_*, whatsapp_number) harus
  // ada di database; tanpa itu order manual tidak bisa disimpan/diverifikasi.
  const schemaReady = schema.ready;
  const reason: ManualPaymentView["reason"] = !schemaReady
    ? "schema_missing"
    : !enabled
      ? "disabled"
      : whatsappNumber
        ? null
        : "no_whatsapp";

  return {
    available: schemaReady && enabled && whatsappNumber !== null,
    schemaReady,
    reason,
    isEnabled,
    envEnabled,
    numberFromDatabase: fromDatabase,
    label,
    sellerName,
    instructions,
    expiryMinutes,
    whatsappNumber,
    whatsappDisplay: whatsappNumber ? formatWhatsappDisplay(whatsappNumber) : null,
    messageTemplate,
    updatedAt: row?.updated_at ?? null,
  };
}

/**
 * Daftar metode yang boleh dipakai untuk membuat order BARU.
 * Isinya 0 atau 1 elemen (MANUAL) — bila kosong, checkout ditolak dengan
 * pesan jelas alih-alih membuat order yang tidak bisa dibayar.
 */
export async function getAvailablePaymentMethods(): Promise<AvailablePaymentMethod[]> {
  const manual = await getManualPaymentView();
  if (!manual.available) return [];
  return [
    {
      id: PAYMENT_METHOD_MANUAL,
      label: manual.label,
      note: "Chat penjual di WhatsApp · bayar sesuai petunjuk · konfirmasi di halaman ini.",
    },
  ];
}

/**
 * Daftar metode pembayaran untuk halaman checkout.
 *
 * Selalu berisi SATU opsi (manual via WhatsApp) supaya pembeli tahu persis
 * bagaimana cara membayar. Bila penjual belum mengatur nomor WhatsApp, opsi
 * ditampilkan NON-AKTIF dengan alasan yang bisa dimengerti — bukan tombol
 * rusak yang gagal setelah diklik.
 */
export async function getCheckoutPaymentMethods(): Promise<AvailablePaymentMethod[]> {
  const manual = await getManualPaymentView();
  return [
    {
      id: PAYMENT_METHOD_MANUAL,
      label: manual.label,
      note: manual.available
        ? "Kamu akan diarahkan chat WhatsApp penjual: detail pembayaran (QRIS / rekening) dikirim di chat, lalu kamu konfirmasi di halaman pembayaran."
        : "Metode ini sedang tidak tersedia. Silakan hubungi penjual.",
      disabled: !manual.available,
    },
  ];
}

/**
 * Tentukan metode untuk order baru. Karena hanya ada satu metode, fungsi ini
 * mengabaikan nilai dari klien dan selalu memakai MANUAL — atau menolak
 * dengan 503 bila penjual belum menyiapkan nomor WhatsApp.
 */
export async function resolvePaymentMethod(_requested?: unknown): Promise<PaymentMethod> {
  const manual = await getManualPaymentView();
  if (!manual.available) {
    log.warn("manual_payment_unavailable", {
      reason: manual.reason,
      schemaReady: manual.schemaReady,
    });
    throw new HttpError(
      503,
      ErrorCodes.paymentUnavailable,
      manual.reason === "no_whatsapp"
        ? "Penjual belum mengatur nomor WhatsApp untuk pembayaran. Silakan hubungi penjual."
        : "Pembayaran sedang tidak tersedia. Silakan hubungi penjual.",
    );
  }
  return PAYMENT_METHOD_MANUAL;
}

export interface ManualSettingsInput {
  is_enabled?: boolean;
  label?: string;
  account_name?: string;
  instructions?: string;
  expiry_minutes?: number;
  /** Nomor WA penjual; wajib valid Indonesia (08… / +62… / 62…). */
  whatsapp_number?: string;
  whatsapp_message_template?: string;
}

/** Simpan konfigurasi pembayaran manual (dipanggil server action admin). */
export async function saveManualPaymentSettings(
  input: ManualSettingsInput,
): Promise<ManualSettingsRow | null> {
  const db = await storeDb();
  const patch: Record<string, unknown> = {};
  if (input.is_enabled !== undefined) patch.is_enabled = input.is_enabled;
  if (input.label !== undefined) patch.label = input.label;
  if (input.account_name !== undefined) patch.account_name = input.account_name;
  if (input.instructions !== undefined) patch.instructions = input.instructions;
  if (input.expiry_minutes !== undefined) patch.expiry_minutes = input.expiry_minutes;
  if (input.whatsapp_message_template !== undefined) {
    patch.whatsapp_message_template = input.whatsapp_message_template;
  }
  if (input.whatsapp_number !== undefined) {
    const normalized = normalizeWhatsapp(input.whatsapp_number);
    if (!normalized) {
      throw new HttpError(
        400,
        ErrorCodes.validation,
        "Nomor WhatsApp penjual tidak valid. Gunakan format 081234567890.",
      );
    }
    patch.whatsapp_number = normalized;
  }

  // Pastikan baris id=1 ada (schema sudah insert default, tapi aman bila belum).
  await db.from("manual_payment_settings").upsert({ id: 1 }, { onConflict: "id" });

  const { data, error } = await db
    .from("manual_payment_settings")
    .update(patch)
    .eq("id", 1)
    .select(SETTINGS_SELECT)
    .single<ManualSettingsRow>();
  if (error) {
    log.error("manual_settings_save_failed", { message: error.message });
    throw new HttpError(500, ErrorCodes.internal, "Gagal menyimpan pengaturan pembayaran.");
  }
  log.info("manual_settings_saved", {
    fields: Object.keys(patch),
    whatsappChanged: patch.whatsapp_number !== undefined,
  });
  return data;
}

/** Nama file migrasi yang harus dijalankan penjual (dipakai pesan admin). */
export const MANUAL_PAYMENT_MIGRATION_HINT = MANUAL_PAYMENT_MIGRATION_FILE;

export { isManualMethod };
