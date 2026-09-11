import type { Metadata } from "next";
import Link from "next/link";
import { ResendForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Verifikasi Email" };

interface Props {
  searchParams: Promise<{ registered?: string; unverified?: string; verified?: string }>;
}

export default async function VerifyPage({ searchParams }: Props) {
  const { registered: _registered, unverified, verified } = await searchParams;

  return (
    <div className="container-x mx-auto max-w-md space-y-4">
      <div className="card p-6 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-brand-100 text-2xl">
          {verified ? "✅" : "📬"}
        </div>
        {verified === "1" ? (
          <>
            <h1 className="mt-3 text-xl font-bold">Email Terverifikasi!</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Akun kamu sudah aktif. Mulai belanja sekarang.
            </p>
            <Link href="/products" className="btn-primary mt-5 w-full">
              Lihat Produk
            </Link>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-xl font-bold">Silakan Cek Email Kamu</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {unverified === "1"
                ? "Akun belum aktif karena email belum diverifikasi."
                : "Kami sudah mengirim link aktivasi ke email kamu."}{" "}
              Buka email lalu klik <strong>Verifikasi Email</strong>. Beli produk baru bisa
              dilakukan setelah email terverifikasi.
            </p>
            <p className="hint mt-2">Tidak menerima email? Cek folder spam / promotions juga.</p>
          </>
        )}
      </div>

      {verified !== "1" && (
        <div className="card p-6">
          <h2 className="text-sm font-semibold">Kirim ulang link verifikasi</h2>
          <div className="mt-3">
            <ResendForm />
          </div>
          <p className="mt-4 text-center text-sm text-slate-500">
            Sudah verifikasi?{" "}
            <Link href="/auth/login" className="text-brand-700 hover:underline">
              Masuk sekarang
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
