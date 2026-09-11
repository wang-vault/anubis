"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Klien BROWSER — hanya untuk Supabase #1 (ACCOUNT), hanya dengan ANON key.
 * Dipakai untuk hal kecil di sisi klien (mis. membaca session untuk UI header).
 * Semua operasi sensitif (order, pembayaran, admin) selalu lewat API server.
 */
export function createAccountBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_ACCOUNT_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ACCOUNT_ANON_KEY!,
  );
}
