import type { Metadata } from "next";
import { ResetForm } from "@/components/AuthForms";
import { getAuthContext } from "@/lib/authz";

export const metadata: Metadata = { title: "Password Baru" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const ctx = await getAuthContext();

  return (
    <div className="container-x mx-auto max-w-md">
      <div className="card p-6">
        <h1 className="text-xl font-bold">Buat Password Baru</h1>
        {ctx ? (
          <div className="mt-5">
            <ResetForm />
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Sesi reset tidak ditemukan atau sudah kedaluwarsa. Buka link <em>reset password</em>{" "}
            dari email kamu, atau minta link baru lewat halaman{" "}
            <a href="/auth/forgot-password" className="text-brand-700 hover:underline">
              Lupa Password
            </a>
            .
          </p>
        )}
      </div>
    </div>
  );
}
