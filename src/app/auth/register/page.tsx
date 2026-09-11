import type { Metadata } from "next";
import { RegisterForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Daftar" };

export default function RegisterPage() {
  return (
    <div className="container-x mx-auto max-w-md">
      <div className="card p-6 sm:p-7">
        <div className="paper-heading">
          <p className="section-kicker">Edisi pembaca · Pendaftaran</p>
          <h1 className="paper-heading-title">Buat akun baru</h1>
          <p className="mt-2 text-sm text-slate-500">
            Setelah mendaftar, cek email untuk mengaktifkan akun kamu.
          </p>
        </div>
        <div className="mt-5">
          <RegisterForm />
        </div>
      </div>
    </div>
  );
}
