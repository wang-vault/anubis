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
      <div className="card p-6">
        <h1 className="text-xl font-bold">Masuk</h1>
        {reset === "1" && (
          <p className="alert-info mt-3">Password berhasil diganti. Silakan masuk dengan password baru.</p>
        )}
        {error === "verify_failed" && (
          <p className="alert-error mt-3">Link verifikasi tidak valid / kedaluwarsa. Login lalu kirim ulang verifikasi.</p>
        )}
        {error === "not_admin" && (
          <p className="alert-error mt-3">Akun kamu bukan akun penjual. Gunakan dashboard pembeli biasa.</p>
        )}
        <div className="mt-5">
          <LoginForm next={next} />
        </div>
      </div>
    </div>
  );
}
