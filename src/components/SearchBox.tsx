import Link from "next/link";
import { PRODUCT_SEARCH_MAX_LEN } from "@/lib/product-search";

/**
 * Kotak pencarian GET (server component, tanpa JS klien).
 *
 * Dipakai halaman katalog publik & daftar produk penjual. Karena memakai
 * `<form method="get">`, pencarian tetap jalan tanpa JavaScript, hasilnya bisa
 * di-bookmark/dibagikan (`?q=...`), dan tombol back browser bekerja normal.
 */
export function SearchBox({
  action,
  id,
  label,
  placeholder,
  defaultValue = "",
  submitLabel = "Cari",
  hidden,
  clearHref,
  maxLength = PRODUCT_SEARCH_MAX_LEN,
  className = "",
  inputClassName = "",
}: {
  /** URL tujuan submit — parameter lain di URL ini dibuang, `q` diisi ulang. */
  action: string;
  /** id unik untuk pasangan label/input (a11y). */
  id: string;
  /** Label untuk screen reader. */
  label: string;
  placeholder?: string;
  defaultValue?: string;
  submitLabel?: string;
  /** Parameter tambahan yang dipertahankan (mis. filter status di admin). */
  hidden?: Record<string, string | undefined>;
  /** Bila diisi dan ada kata kunci, tampilkan tautan "Hapus" ke URL ini. */
  clearHref?: string;
  maxLength?: number;
  className?: string;
  inputClassName?: string;
}) {
  const term = defaultValue ?? "";

  return (
    <form className={`search-bar ${className}`.trim()} action={action} method="get" role="search">
      {Object.entries(hidden ?? {}).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`input search-bar-input ${inputClassName}`.trim()}
        type="search"
        name="q"
        defaultValue={term}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      <button className="btn-secondary btn-sm shrink-0" type="submit">
        {submitLabel}
      </button>
      {clearHref && term && (
        <Link href={clearHref} className="paper-link shrink-0 text-xs font-bold">
          Hapus
        </Link>
      )}
    </form>
  );
}
