"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  forgotPasswordAction,
  resendVerificationAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
  type ActionState,
} from "@/app/auth/actions";

const initialState: ActionState = {};

function FormError({ state }: { state: ActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="alert-error">{state.error}</p>}
      {state.info && <p className="alert-info">{state.info}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
export function LoginForm({
  adminMode = false,
  next,
}: {
  adminMode?: boolean;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="mode" value={adminMode ? "admin" : "user"} />
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label className="label" htmlFor="login-email">Email</label>
        <input id="login-email" className="input" name="email" type="email" required autoComplete="email" autoFocus />
      </div>
      <div>
        <label className="label" htmlFor="login-password">Password</label>
        <input id="login-password" className="input" name="password" type="password" required autoComplete="current-password" />
      </div>
      <FormError state={state} />
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Memproses…" : "Masuk"}
      </button>
      <div className="flex items-center justify-between text-sm">
        <Link href="/auth/forgot-password" className="text-brand-700 hover:underline">
          Lupa password?
        </Link>
        {!adminMode && (
          <Link href="/auth/register" className="text-brand-700 hover:underline">
            Buat akun
          </Link>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function RegisterForm() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);
  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="label" htmlFor="reg-name">Nama</label>
        <input id="reg-name" className="input" name="name" required minLength={2} maxLength={80} placeholder="Nama kamu" />
      </div>
      <div>
        <label className="label" htmlFor="reg-email">Email</label>
        <input id="reg-email" className="input" name="email" type="email" required autoComplete="email" placeholder="kamu@email.com" />
      </div>
      <div>
        <label className="label" htmlFor="reg-password">Password</label>
        <input id="reg-password" className="input" name="password" type="password" required minLength={8} autoComplete="new-password" />
        <p className="hint">Minimal 8 karakter.</p>
      </div>
      <div>
        <label className="label" htmlFor="reg-whatsapp">Nomor WhatsApp</label>
        <input id="reg-whatsapp" className="input" name="whatsapp" inputMode="tel" required placeholder="081234567890" />
        <p className="hint">Format Indonesia, contoh 0812-3456-7890.</p>
      </div>
      <div className="alert-warn">
        ⚠️ Pastikan nomor WhatsApp yang kamu masukkan <strong>aktif dan benar</strong>.
        Pesanan akan dikirim melalui WhatsApp ke nomor tersebut. Kesalahan nomor menjadi
        tanggung jawab pembeli.
      </div>
      <FormError state={state} />
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Memproses…" : "Daftar Sekarang"}
      </button>
      <p className="text-center text-sm text-slate-500">
        Sudah punya akun?{" "}
        <Link href="/auth/login" className="text-brand-700 hover:underline">Masuk</Link>
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function ResendForm() {
  const [state, formAction, pending] = useActionState(resendVerificationAction, initialState);
  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label className="label" htmlFor="resend-email">Email kamu</label>
        <input id="resend-email" className="input" name="email" type="email" required placeholder="kamu@email.com" />
      </div>
      <FormError state={state} />
      <button type="submit" className="btn-secondary w-full" disabled={pending}>
        {pending ? "Mengirim…" : "Kirim Ulang Email Verifikasi"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function ForgotForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initialState);
  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="label" htmlFor="forgot-email">Email</label>
        <input id="forgot-email" className="input" name="email" type="email" required autoComplete="email" />
      </div>
      <FormError state={state} />
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Mengirim…" : "Kirim Link Reset Password"}
      </button>
      <p className="text-center text-sm">
        <Link href="/auth/login" className="text-brand-700 hover:underline">Kembali ke login</Link>
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function ResetForm() {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);
  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="label" htmlFor="reset-password">Password baru</label>
        <input id="reset-password" className="input" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      <div>
        <label className="label" htmlFor="reset-confirm">Ulangi password baru</label>
        <input id="reset-confirm" className="input" name="confirm" type="password" required autoComplete="new-password" />
      </div>
      <FormError state={state} />
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Menyimpan…" : "Simpan Password Baru"}
      </button>
    </form>
  );
}
