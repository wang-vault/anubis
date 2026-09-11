import type { Metadata } from "next";
import { LoginForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Masuk" };

interface Props {
  searchParams: Promise<{ error?: string; reset?: string; next?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const { error, reset, next } = await searchParams;

  return (
    <div className="container-x mx-auto max-w-md">
      <div className="card p-6 sm:p-7">
        <div className="paper-heading">
          <p className="section-kicker">Akun pembaca · Edisi masuk</p>
          <h1 className="paper-heading-title">Masuk</h1>
          <p className="mt-2 text-sm text-slate-500">Lanjutkan membaca katalog dan lacak pesananmu.</p>
        </div>
        {reset === "1" && (
          <p className="alert-info mt-4">Password berhasil diganti. Silakan masuk dengan password baru.</p>
        )}
        {error === "verify_failed" && (
          <p className="alert-error mt-4">Link verifikasi tidak valid / kedaluwarsa. Login lalu kirim ulang verifikasi.</p>
        )}
        {error === "not_admin" && (
          <p className="alert-error mt-4">Akun kamu bukan akun penjual. Gunakan dashboard pembeli biasa.</p>
        )}
        <div className="mt-5">
          <LoginForm next={next} />
        </div>
      </div>
    </div>
  );
}
