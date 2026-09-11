import type { Metadata } from "next";
import { ForgotForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Lupa Password" };

export default function ForgotPasswordPage() {
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
