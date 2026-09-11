import type { Metadata } from "next";
import { RegisterForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Daftar" };

export default function RegisterPage() {
  return (
    <div className="container-x mx-auto max-w-md">
      <div className="card p-6">
        <h1 className="text-xl font-bold">Buat Akun Baru</h1>
        <p className="mt-1 text-sm text-slate-500">
          Setelah mendaftar, cek email untuk mengaktifkan akun kamu.
        </p>
        <div className="mt-5">
          <RegisterForm />
        </div>
      </div>
    </div>
  );
}
