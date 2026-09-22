"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { accountAdmin, accountServer } from "@/lib/supabase/server";
import { emailSchema, loginSchema, passwordSchema, registerSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/ratelimit";
import { sanitizeNextPath } from "@/lib/next-url";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import {
  PENDING_REGISTER_COOKIE,
  PENDING_REGISTER_MAX_AGE,
} from "@/lib/auth-redirects";

/**
 * Seluruh alur autentikasi berjalan SERVER-SIDE memakai Supabase Auth
 * (project #1). Tidak ada sistem password/session buatan sendiri.
 * Session disimpan sebagai httpOnly cookie oleh @supabase/ssr.
 */

export interface ActionState {
  error?: string;
  info?: string;
}

function callbackUrl(next: string): string {
  return `${serverEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/auth/callback?next=${encodeURIComponent(next)}`;
}

async function clientIpFromHeaders(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function sanitizeNext(raw: FormDataEntryValue | null, fallback: string): string {
  return sanitizeNextPath(typeof raw === "string" ? raw : "", fallback);
}

// ---------------------------------------------------------------------------
// REGISTER — Supabase Auth signUp + profil via DB trigger (handle_new_user)
// ---------------------------------------------------------------------------
export async function signUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    whatsapp: formData.get("whatsapp"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  const ip = await clientIpFromHeaders();
  if (!rateLimit(`signup:${ip}`, 5, 10 * 60_000).ok) {
    return { error: "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi." };
  }

  const supabase = await accountServer();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { name: parsed.data.name, whatsapp: parsed.data.whatsapp },
      emailRedirectTo: callbackUrl("/auth/verify"),
    },
  });
  if (error) {
    const msg = error.message ?? "";
    // "User already registered" → SAMA-kan respons dengan sukses (anti-enumeration),
    // Supabase tidak mengirim email kedua ke email yang sudah terdaftar.
    if (!/already registered|already exists/i.test(msg)) {
      log.warn("signup_error", { kind: "provider", message: msg });
      if (/rate limit/i.test(msg)) {
        return { error: "Terlalu banyak email dikirim. Coba lagi dalam beberapa menit." };
      }
      return { error: "Pendaftaran gagal. Coba lagi atau hubungi penjual." };
    }
  }
  // Tandai "baru mendaftar" (httpOnly, umur pendek): selama email belum
  // diverifikasi, halaman /auth/register mengarahkan ke /auth/verify alih-alih
  // menampilkan form daftar lagi (dicek di middleware + guardAuthPage).
  const jar = await cookies();
  jar.set(PENDING_REGISTER_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: PENDING_REGISTER_MAX_AGE,
  });
  redirect("/auth/verify?registered=1");
}

// ---------------------------------------------------------------------------
// LOGIN — buyer (default) & admin (mode=admin → cek role dari DB)
// ---------------------------------------------------------------------------
export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const isAdminMode = formData.get("mode") === "admin";
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }
  const ip = await clientIpFromHeaders();
  const rl = rateLimit(`login:${ip}:${parsed.data.email}`, 8, 5 * 60_000);
  if (!rl.ok) {
    return { error: `Terlalu banyak percobaan login. Coba lagi dalam ${rl.retryAfterSec} detik.` };
  }

  const supabase = await accountServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (/not confirmed/i.test(error.message ?? "")) {
      redirect("/auth/verify?unverified=1");
    }
    // Pesan sengaja generik: tidak menyebut email mana yang terdaftar.
    return { error: "Email atau password salah." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(user.email_confirmed_at ?? user.confirmed_at)) {
    await supabase.auth.signOut();
    redirect("/auth/verify?unverified=1");
  }

  let isAdminRole = false;
  if (isAdminMode) {
    const admin = await accountAdmin();
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle<{ role: string }>();
    isAdminRole = profile?.role === "admin";
    if (!isAdminRole) {
      await supabase.auth.signOut();
      return { error: "Akun ini bukan akun penjual. Login lewat halaman login biasa." };
    }
  }

  // Login sukses & terverifikasi → pendaftaran dianggap selesai: hapus
  // penanda "baru daftar" supaya form daftar bisa dibuka lagi bila perlu.
  (await cookies()).delete(PENDING_REGISTER_COOKIE);

  redirect(sanitizeNext(formData.get("next"), isAdminRole ? "/admin" : "/"));
}

export async function signOutAction(): Promise<void> {
  const supabase = await accountServer();
  await supabase.auth.signOut();
  // Keluar = mulai bersih: penanda "baru daftar" ikut dihapus supaya user
  // bebas membuka form daftar lagi bila memang ingin mendaftar akun lain.
  (await cookies()).delete(PENDING_REGISTER_COOKIE);
  redirect("/");
}

// ---------------------------------------------------------------------------
// RESEND VERIFICATION EMAIL
// ---------------------------------------------------------------------------
export async function resendVerificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Masukkan email yang valid." };
  const ip = await clientIpFromHeaders();
  if (!rateLimit(`resend:${ip}`, 3, 10 * 60_000).ok) {
    return { error: "Terlalu sering mengirim ulang. Tunggu beberapa menit." };
  }
  const supabase = await accountServer();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data,
    options: { emailRedirectTo: callbackUrl("/auth/verify") },
  });
  if (error) {
    log.warn("resend_error", { message: error.message });
  }
  // Balasan selalu sama (anti-enumeration).
  return {
    info: "Jika email itu terdaftar dan belum diverifikasi, link verifikasi baru telah dikirim. Cek kotak masuk & folder spam.",
  };
}

// ---------------------------------------------------------------------------
// FORGOT / RESET PASSWORD
// ---------------------------------------------------------------------------
export async function forgotPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Masukkan email yang valid." };
  const ip = await clientIpFromHeaders();
  if (!rateLimit(`forgot:${ip}`, 3, 10 * 60_000).ok) {
    return { error: "Terlalu sering meminta reset. Tunggu beberapa menit." };
  }
  const supabase = await accountServer();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: callbackUrl("/auth/reset-password"),
  });
  if (error) log.warn("forgot_password_error", { message: error.message });
  return {
    info: "Jika email itu terdaftar, link reset password telah dikirim. Cek kotak masuk & folder spam.",
  };
}

export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const passwordParsed = passwordSchema.safeParse(formData.get("password"));
  if (!passwordParsed.success) {
    return { error: passwordParsed.error.issues[0]?.message ?? "Password tidak valid." };
  }
  if (formData.get("confirm") !== formData.get("password")) {
    return { error: "Konfirmasi password tidak sama." };
  }
  const supabase = await accountServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: "Link reset sudah tidak berlaku. Minta link baru lewat menu Lupa Password.",
    };
  }
  const { error } = await supabase.auth.updateUser({ password: passwordParsed.data });
  if (error) {
    log.warn("reset_password_error", { message: error.message });
    return { error: "Gagal mengganti password. Minta link reset baru." };
  }
  await supabase.auth.signOut(); // login ulang dengan password baru
  redirect("/auth/login?reset=1");
}
