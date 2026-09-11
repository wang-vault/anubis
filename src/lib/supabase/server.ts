import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Klien Supabase — HANYA boleh di-import dari kode server (server-only).
 *
 * Service role key TIDAK PERNAH dipakai di browser dan TIDAK PERNAH di-import
 * dari komponen client. Build akan gagal bila file ini ikut ke bundle browser.
 */

/** Akun (Supabase #1) — klien dengan cookie session user (getUser, updateUser, dst). */
export const accountServer = cache(async () => {
  const env = serverEnv();
  const cookieStore = await cookies();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_ACCOUNT_URL,
    env.NEXT_PUBLIC_SUPABASE_ACCOUNT_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Dipanggil dari Server Component (read-only cookies).
            // Middleware tetap menyegarkan session; lihat src/middleware.ts.
          }
        },
      },
    },
  );
});

/** Akun (Supabase #1) — service role, untuk lookup profil & aksi admin. */
export const accountAdmin = cache(async (): Promise<SupabaseClient> => {
  const env = serverEnv();
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_ACCOUNT_URL,
    env.SUPABASE_ACCOUNT_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
});

/** Store (Supabase #2) — service role. Satu-satunya jalur akses orders (RLS deny-all). */
export const storeDb = cache(async (): Promise<SupabaseClient> => {
  const env = serverEnv();
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_STORE_URL,
    env.SUPABASE_STORE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
});
