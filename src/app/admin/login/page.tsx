import type { Metadata } from "next";
import { LoginForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Masuk Penjual" };

export default function AdminLoginPage() {
  return (
    <div className="container-x mx-auto max-w-md">
      <div className="card p-6">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-900 text-xl text-white">
          🔐
        </div>
        <h1 className="mt-3 text-center text-xl font-bold">Dashboard Penjual</h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          Masuk dengan akun yang memiliki role <code className="rounded bg-slate-100 px-1">admin</code>.
        </p>
        <div className="mt-5">
          <LoginForm adminMode next="/admin" />
        </div>
      </div>
    </div>
  );
}
