import type { Metadata } from "next";
import { ForgotForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Lupa Password" };

export default function ForgotPasswordPage() {
  return (
    <div className="container-x mx-auto max-w-md">
      <div className="card p-6">
        <h1 className="text-xl font-bold">Lupa Password</h1>
        <p className="mt-1 text-sm text-slate-500">
          Masukkan email akun kamu. Kami kirim link untuk membuat password baru.
        </p>
        <div className="mt-5">
          <ForgotForm />
        </div>
      </div>
    </div>
  );
}
