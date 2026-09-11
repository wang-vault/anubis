import type { Metadata } from "next";
import { LoginForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Masuk Penjual" };

export default function AdminLoginPage() {
  return (
    <div className="container-x mx-auto max-w-md">
      <div className="card p-6 sm:p-7">
        <div className="mx-auto grid size-12 place-items-center border border-slate-900 bg-slate-900 font-serif text-xl text-white">
          AD
        </div>
        <div className="paper-heading mt-4 text-center">
          <p className="section-kicker justify-center">Kantor redaksi · Akses privat</p>
          <h1 className="paper-heading-title">Dashboard penjual</h1>
          <p className="mt-2 text-sm text-slate-500">
            Masuk dengan akun yang memiliki role <code className="border border-slate-300 bg-slate-100 px-1">admin</code>.
          </p>
        </div>
        <div className="mt-5">
          <LoginForm adminMode next="/admin" />
        </div>
      </div>
    </div>
  );
}
