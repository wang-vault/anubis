import "server-only";
import type { Session, User } from "@supabase/supabase-js";
import { cache } from "react";
import { accountAdmin, accountServer } from "@/lib/supabase/server";
import { HttpError, ErrorCodes } from "@/lib/api";
import type { ProfileRow } from "@/lib/types";

/**
 * Model otorisasi SERVER-SIDE.
 *
 * - Session dibaca dari cookie Supabase Auth (proyek #1) via getUser() —
 *   diverifikasi ke server Supabase, bukan sekadar decode token di klien.
 * - Role (buyer/admin) dibaca dari tabel profiles lewat service role.
 *   Peran TIDAK ditentukan dari frontend, email, atau query string.
 */
export interface AuthContext {
  user: User;
  session: Session;
  profile: ProfileRow | null;
  emailVerified: boolean;
}

export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await accountServer();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  // getUser() memverifikasi access token ke server Supabase (anti-token palsu).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = await accountAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("id,name,email,whatsapp,role,created_at,updated_at")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  return {
    user,
    session,
    profile,
    emailVerified: Boolean(user.email_confirmed_at ?? user.confirmed_at),
  };
});

/** Wajib login. */
export async function requireUser(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    throw new HttpError(
      401,
      ErrorCodes.unauthorized,
      "Silakan login terlebih dahulu.",
    );
  }
  return ctx;
}

/** Wajib login + email terverifikasi (syarat membeli). */
export async function requireVerifiedUser(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (!ctx.emailVerified) {
    throw new HttpError(
      403,
      ErrorCodes.emailNotVerified,
      "Email kamu belum diverifikasi. Buka link verifikasi di email kamu dulu ya.",
    );
  }
  if (!ctx.profile) {
    throw new HttpError(403, ErrorCodes.forbidden, "Profil akun tidak ditemukan.");
  }
  return ctx;
}

/** Wajib role admin (divalidasi server-side dari DB). */
export async function requireAdmin(): Promise<AuthContext & { profile: ProfileRow }> {
  const ctx = await requireUser();
  if (!ctx.profile || ctx.profile.role !== "admin") {
    throw new HttpError(
      403,
      ErrorCodes.forbidden,
      "Akses ditolak: area khusus penjual/admin.",
    );
  }
  return ctx as AuthContext & { profile: ProfileRow };
}

export function isAdmin(ctx: AuthContext | null): boolean {
  return ctx?.profile?.role === "admin";
}
