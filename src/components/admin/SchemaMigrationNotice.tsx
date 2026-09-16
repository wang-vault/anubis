import {
  MANUAL_PAYMENT_MIGRATION_FILE,
  MANUAL_PAYMENT_MIGRATION_SQL,
  type StoreSchemaCheck,
} from "@/lib/store-schema";

/**
 * Banner "database perlu dimigrasi" — muncul di setiap halaman /admin selama
 * kolom pembayaran manual belum ada di Supabase #2.
 *
 * Konteks: kode aplikasi bisa lebih baru daripada skema database yang sedang
 * dipakai (penjual menjalankan 001_schema.sql versi lama). Query yang
 * menyentuh `orders.payment_method` lalu gagal dengan SQLSTATE 42703 — dulu
 * itu menjatuhkan dashboard menjadi "Application error". Sekarang dashboard
 * tetap tampil dan banner ini menjelaskan satu langkah perbaikannya.
 *
 * Server component: SQL-nya diambil dari konstanta yang sama dengan yang
 * dipakai log, jadi tidak ada dua versi instruksi yang bisa saling berbeda.
 */
export function SchemaMigrationNotice({ check }: { check: StoreSchemaCheck }) {
  const missingTable = check.reason === "missing_table";

  return (
    <div className="alert-error" role="alert">
      <p className="section-kicker">Perlu tindakan penjual</p>
      <p className="mt-1 font-serif text-base font-black">
        {missingTable
          ? "Tabel toko belum ada di Supabase #2"
          : "Database toko belum dimigrasi — pembayaran manual non-aktif"}
      </p>
      <p className="mt-1 text-sm leading-6">
        {missingTable ? (
          <>
            Supabase #2 belum memiliki tabel <code>orders</code>. Jalankan{" "}
            <code>supabase/store/001_schema.sql</code> lalu{" "}
            <code>{MANUAL_PAYMENT_MIGRATION_FILE}</code> di SQL Editor.
          </>
        ) : (
          <>
            Kolom pembayaran manual (<code>payment_method</code>, <code>manual_*</code>) belum ada di
            database, padahal aplikasi sudah memakainya. Tanpa perbaikan ini, antrian verifikasi
            transfer manual kosong dan order manual tidak bisa dibuat. Situs tetap berjalan —
            perbaikannya satu langkah di bawah.
          </>
        )}
      </p>
      {check.message && (
        <p className="mt-2 border-l-2 border-red-900/40 pl-2 font-mono text-xs text-red-900/80">
          {check.message}
        </p>
      )}

      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
        <li>
          Buka Supabase <strong>#2 (store)</strong> → <strong>SQL Editor</strong> → <strong>New query</strong>.
        </li>
        <li>
          Tempel SQL di bawah (atau isi file <code>{MANUAL_PAYMENT_MIGRATION_FILE}</code>), lalu{" "}
          <strong>Run</strong>. Aman dijalankan berulang — tidak menghapus data.
        </li>
        <li>
          Muat ulang halaman ini. Pemeriksaan otomatis diulang tiap ±1 menit, jadi{" "}
          <strong>tidak perlu redeploy</strong>.
        </li>
      </ol>

      <pre className="mt-3 max-h-72 overflow-auto border border-red-900/30 bg-white/70 p-3 text-[11px] leading-5">
        {MANUAL_PAYMENT_MIGRATION_SQL}
      </pre>
    </div>
  );
}
