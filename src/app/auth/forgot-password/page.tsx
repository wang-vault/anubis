import type { Metadata } from "next";
import { ForgotForm } from "@/components/AuthForms";
import { guardAuthPage } from "@/lib/auth-guards";

export const metadata: Metadata = { title: "Lupa Password" };

export default async function ForgotPasswordPage() {
  // Halaman khusus tamu: user yang sudah login diarahkan keluar.
  await guardAuthPage({ pathname: "/auth/forgot-password" });

  return (
    <div className="container-x mx-auto max-w-md">
      <div className="card p-6 sm:p-7">
        <div className="paper-heading">
          <p className="section-kicker">Bantuan akun · Redaksi</p>
          <h1 className="paper-heading-title">Lupa password</h1>
          <p className="mt-2 text-sm text-slate-500">
            Masukkan email akun kamu. Kami kirim link untuk membuat password baru.
          </p>
        </div>
        <div className="mt-5">
          <ForgotForm />
        </div>
      </div>
    </div>
  );
}
