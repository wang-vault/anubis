import "server-only";
import { ErrorCodes, HttpError } from "@/lib/api";
import { serverEnv, yobasepayConfigured } from "@/lib/env";
import { log } from "@/lib/logger";
import { storeDb } from "@/lib/supabase/server";
import { MANUAL_PAYMENT_MIGRATION_FILE, checkStoreSchema } from "@/lib/store-schema";
import {
  PAYMENT_METHOD_AUTO,
  PAYMENT_METHOD_MANUAL,
  isPaymentMethod,
  normalizePaymentMethod,
  type AvailablePaymentMethod,
  type PaymentMethod,
} from "@/lib/payment-methods";

/**
 * ===========================================================================
 * KONFIGURASI METODE PEMBAYARAN (server-side)
 * ===========================================================================
 * Sumber konfigurasi pembayaran MANUAL = tabel `manual_payment_settings`
 * (Supabase #2) + env opsional. Di-edit penjual lewat /admin/settings tanpa
 * perlu deploy ulang.
 *
 * Gambar QR disimpan sebagai base64 di DB dan disajikan lewat
 * GET /api/manual-qr, jadi:
 *  - tidak perlu bucket storage / hosting eksternal,
 *  - halaman bayar tidak meng-embed data URI besar di HTML.
 */

/** Batas ukuran gambar QR yang diterima (Next.js server action default 1 MB). */
export const MANUAL_QR_MAX_BYTES = 900 * 1024;
/** MIME yang diizinkan untuk gambar QR. */
export const MANUAL_QR_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
/** Endpoint gambar QR statis (dipakai <img src> & panel admin). */
export const MANUAL_QR_ENDPOINT = "/api/manual-qr";

export interface ManualSettingsRow {
  id: number;
  is_enabled: boolean;
  label: string;
  account_name: string;
  instructions: string;
  expiry_minutes: number;
  qr_image_mime: string;
  qr_image_base64: string | null;
  qr_image_size: number;
  updated_at: string;
}

/** Ringkasan aman untuk UI (tanpa isi gambar). */
export interface ManualPaymentView {
  /** Metode manual bisa dipakai buyer? (enabled + QR tersedia + skema siap) */
  available: boolean;
  /** Kolom pembayaran manual ada di database (migrasi 002 sudah dijalankan). */
  schemaReady: boolean;
  /** Kenapa tidak tersedia — untuk pesan di dashboard admin. */
  reason: "disabled" | "no_qr" | "schema_missing" | null;
  /** Saklar di DB (form /admin/settings). */
  isEnabled: boolean;
  /** Saklar env MANUAL_PAYMENT_ENABLED. */
  envEnabled: boolean;
  label: string;
  accountName: string;
  instructions: string;
  expiryMinutes: number;
  /** Nilai untuk atribut src <img> — null bila belum ada QR. */
  qrSrc: string | null;
  hasUploadedImage: boolean;
  updatedAt: string | null;
}

const SETTINGS_SELECT =
  "id,is_enabled,label,account_name,instructions,expiry_minutes,qr_image_mime,qr_image_base64,qr_image_size,updated_at";

export async function getManualPaymentSettings(): Promise<ManualSettingsRow | null> {
  const db = await storeDb();
  const { data, error } = await db
    .from("manual_payment_settings")
    .select(SETTINGS_SELECT)
    .eq("id", 1)
    .maybeSingle<ManualSettingsRow>();
  if (error) {
    // Tabel belum di-migrate → jangan jatuhkan seluruh app; metode manual
    // dianggap belum dikonfigurasi, metode lain tetap jalan.
    log.error("manual_settings_fetch_failed", { message: error.message });
    return null;
  }
  return data;
}

export async function getManualPaymentView(): Promise<ManualPaymentView> {
  const env = serverEnv();
  const [row, schema] = await Promise.all([getManualPaymentSettings(), checkStoreSchema()]);

  const label = row?.label?.trim() || "Transfer Manual (QRIS)";
  const accountName = row?.account_name ?? "";
  const instructions = row?.instructions ?? "";
  const expiryMinutes = row?.expiry_minutes ?? 120;
  const hasUploadedImage = Boolean(row?.qr_image_base64);
  const externalUrl = env.MANUAL_PAYMENT_QR_IMAGE_URL || null;

  const qrSrc = externalUrl
    ? externalUrl
    : hasUploadedImage
      ? `${MANUAL_QR_ENDPOINT}?v=${encodeURIComponent(row?.updated_at ?? "1")}`
      : null;

  const isEnabled = row?.is_enabled ?? false;
  const envEnabled = env.MANUAL_PAYMENT_ENABLED;
  const enabled = envEnabled && isEnabled;
  // Kolom pembayaran manual (payment_method, manual_*) harus ada di database;
  // tanpa itu order manual tidak bisa disimpan maupun diverifikasi.
  const schemaReady = schema.ready;
  const reason: ManualPaymentView["reason"] = !schemaReady
    ? "schema_missing"
    : !enabled
      ? "disabled"
      : qrSrc
        ? null
        : "no_qr";

  return {
    available: schemaReady && enabled && qrSrc !== null,
    schemaReady,
    reason,
    isEnabled,
    envEnabled,
    label,
    accountName,
    instructions,
    expiryMinutes,
    qrSrc,
    hasUploadedImage,
    updatedAt: row?.updated_at ?? null,
  };
}

/**
 * Daftar metode yang boleh dipilih buyer (sudah disaring yang tidak tersedia).
 * Tipe AvailablePaymentMethod ada di lib/payment-methods.ts (modul murni) agar
 * aman di-import komponen klien.
 * Selalu mengembalikan minimal satu metode; bila tidak ada yang tersedia,
 * kembalikan daftar kosong dan biarkan pemanggil menolak checkout.
 */
export async function getAvailablePaymentMethods(): Promise<AvailablePaymentMethod[]> {
  const env = serverEnv();
  const manual = await getManualPaymentView();
  const list: AvailablePaymentMethod[] = [];

  if (yobasepayConfigured(env)) {
    list.push({
      id: PAYMENT_METHOD_AUTO,
      label: "QRIS Otomatis",
      note: "QR dibuat otomatis · status lunas terdeteksi sistem.",
    });
  }
  if (manual.available) {
    list.push({
      id: PAYMENT_METHOD_MANUAL,
      label: manual.label,
      note: "Scan QR penjual · transfer sendiri · konfirmasi di halaman ini.",
    });
  }
  return list;
}

/**
 * Daftar metode pembayaran yang ditampilkan di halaman checkout kepada pembeli.
 *
 * Kedua opsi SELALU ditampilkan supaya pembeli tahu metode apa yang tersedia:
 *  - Pembayaran manual: opsi utama & default (aktif bila penjual sudah
 *    mengaktifkan saklar + mengunggah QR).
 *  - QRIS Otomatis: **bisa dipilih** bila kredensial YoBasePay terisi
 *    (`YOBASEPAY_API_KEY` + `YOBASEPAY_WEBHOOK_SECRET`). Bila belum terisi,
 *    opsi ini tampil ber-badge **"Ongoing"** dan tidak bisa dipilih (disabled)
 *    agar pembeli tidak mengira tokonya rusak — mereka diarahkan ke Transfer
 *    Manual, persis seperti sebelum integrasi QRIS dibuka.
 *
 * Catatan: keputusan "boleh dieksekusi server" tetap di
 * `getAvailablePaymentMethods()`/`resolvePaymentMethod()`, jadi ketika QRIS
 * otomatis tampil aktif di UI, server sudah pasti menerimanya (dan
 * sebaliknya).
 */
export async function getCheckoutPaymentMethods(): Promise<AvailablePaymentMethod[]> {
  const env = serverEnv();
  const manual = await getManualPaymentView();
  const autoReady = yobasepayConfigured(env);
  const list: AvailablePaymentMethod[] = [];

  // 1. Opsi Manual DULU (aktif untuk proses belanja, jadi pilihan default)
  const manualLabel = manual.label?.trim() || "Transfer Manual";
  list.push({
    id: PAYMENT_METHOD_MANUAL,
    label: manualLabel,
    note: manual.schemaReady
      ? "Transfer mandiri via rekening/e-wallet/QRIS statis penjual · konfirmasi di halaman pembayaran."
      : "Metode ini sedang tidak tersedia. Silakan hubungi penjual.",
    disabled: !manual.available,
  });

  // 2. Opsi QRIS — aktif bila terkonfigurasi, selain itu status ongoing
  list.push(
    autoReady
      ? {
          id: PAYMENT_METHOD_AUTO,
          label: "QRIS Otomatis",
          note: "QR dibuat otomatis · nominal terisi sendiri · status lunas terdeteksi sistem (tanpa konfirmasi penjual).",
        }
      : {
          id: PAYMENT_METHOD_AUTO,
          label: "QRIS Otomatis",
          note: "Metode pembayaran QRIS sedang dalam proses (status ongoing). Silakan gunakan opsi Transfer Manual terlebih dahulu.",
          disabled: true,
          isOngoing: true,
          statusBadge: "Ongoing",
        },
  );

  return list;
}

/**
 * Tentukan metode untuk order baru.
 *  - tidak diisi        → default dari env (bila tersedia), selain itu satu-satunya
 *    metode yang tersedia.
 *  - diisi tapi tidak tersedia → 409 (pesan jelas ke buyer, bukan 500).
 */
export async function resolvePaymentMethod(requested: unknown): Promise<PaymentMethod> {
  const available = await getAvailablePaymentMethods();
  if (available.length === 0) {
    throw new HttpError(
      503,
      ErrorCodes.paymentUnavailable,
      "Pembayaran sedang tidak tersedia. Silakan hubungi penjual.",
    );
  }

  const env = serverEnv();
  const first = available[0]?.id ?? PAYMENT_METHOD_MANUAL;
  const preferred = isPaymentMethod(env.DEFAULT_PAYMENT_METHOD)
    ? env.DEFAULT_PAYMENT_METHOD
    : first;
  const fallback = available.some((m) => m.id === preferred) ? preferred : first;

  if (requested === undefined || requested === null || requested === "") return fallback;

  const chosen = normalizePaymentMethod(requested, fallback);
  if (!available.some((m) => m.id === chosen)) {
    const schema = await checkStoreSchema();
    if (!schema.ready) {
      // Pesan untuk buyer tetap umum; detail teknis hanya ke log.
      log.warn("payment_method_unavailable_schema_gap", {
        chosen,
        reason: schema.reason,
        migration: MANUAL_PAYMENT_MIGRATION_FILE,
      });
    }
    throw new HttpError(
      409,
      ErrorCodes.conflict,
      chosen === PAYMENT_METHOD_AUTO
        ? "Pembayaran QRIS otomatis sedang dalam proses (status ongoing). Silakan gunakan opsi Transfer Manual terlebih dahulu."
        : schema.ready
          ? "Pembayaran manual belum dikonfigurasi penjual. Pilih metode lain."
          : "Pembayaran manual sedang tidak tersedia. Silakan hubungi penjual.",
    );
  }
  return chosen;
}

/** Baca gambar QR statis untuk disajikan sebagai image response. */
export async function getManualQrImage(): Promise<
  { mime: string; base64: string; version: string } | null
> {
  const env = serverEnv();
  if (env.MANUAL_PAYMENT_QR_IMAGE_URL) return null; // pakai URL eksternal
  const row = await getManualPaymentSettings();
  if (!row?.qr_image_base64) return null;
  return {
    mime: row.qr_image_mime || "image/png",
    base64: row.qr_image_base64,
    version: row.updated_at ?? "1",
  };
}

export interface ManualSettingsInput {
  is_enabled?: boolean;
  label?: string;
  account_name?: string;
  instructions?: string;
  expiry_minutes?: number;
  /** Ganti gambar QR; null = biarkan gambar lama; "" (kosong) = hapus gambar. */
  qr_image?: { mime: string; base64: string; size: number } | null | "clear";
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

  if (input.qr_image === "clear") {
    patch.qr_image_base64 = null;
    patch.qr_image_mime = "image/png";
    patch.qr_image_size = 0;
  } else if (input.qr_image) {
    patch.qr_image_base64 = input.qr_image.base64;
    patch.qr_image_mime = input.qr_image.mime;
    patch.qr_image_size = input.qr_image.size;
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
    throw new HttpError(500, ErrorCodes.internal, "Gagal menyimpan pengaturan pembayaran manual.");
  }
  log.info("manual_settings_saved", {
    fields: Object.keys(patch),
    imageSize: patch.qr_image_size ?? undefined,
  });
  return data;
}
