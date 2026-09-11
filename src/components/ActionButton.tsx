"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Tombol untuk server action. Selain memberi umpan balik saat request berjalan,
 * komponen ini mencegah double-submit pada aksi yang mengubah data.
 */
export function ActionButton({
  children,
  pendingText = "Memproses…",
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  pendingText?: ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button {...props} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending ? pendingText : children}
    </button>
  );
}
