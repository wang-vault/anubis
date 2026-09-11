import type { Metadata } from "next";
import { ResetForm } from "@/components/AuthForms";
import { getAuthContext } from "@/lib/authz";

export const metadata: Metadata = { title: "Password Baru" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const ctx = await getAuthContext();

  return (
    <div className="container-x mx-auto max-w-md">
      <div className="card p-6 sm:p-7">
        <div className="paper-heading">
          <p className="section-kicker">Bantuan akun · Edisi aman</p>
          <h1 className="paper-heading-title">Buat password baru</h1>
        </div>
        {ctx ? (
          <div className="mt-5">
            <ResetForm />
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-slate-600">
            Sesi reset tidak ditemukan atau sudah kedaluwarsa. Buka link <em>reset password</em>{" "}
            dari email kamu, atau minta link baru lewat halaman{" "}
            <a href="/auth/forgot-password" className="paper-link font-semibold">
              Lupa Password
            </a>
            .
          </p>
        )}
      </div>
    </div>
  );
}
