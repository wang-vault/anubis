import type { Metadata } from "next";
import Link from "next/link";
import { ResendForm } from "@/components/AuthForms";
import { guardAuthPage } from "@/lib/auth-guards";

export const metadata: Metadata = { title: "Verifikasi Email" };

interface Props {
  searchParams: Promise<{ registered?: string; unverified?: string; verified?: string }>;
}

export default async function VerifyPage({ searchParams }: Props) {
  const { registered: _registered, unverified, verified } = await searchParams;

  // User yang sudah login & terverifikasi tidak perlu melihat "cek email" —
  // kecuali justru baru menyelesaikan verifikasi (?verified=1, layar sukses).
  await guardAuthPage({ pathname: "/auth/verify", verifiedFlag: verified === "1" });

  return (
    <div className="container-x mx-auto max-w-md space-y-4">
      <div className="card p-6 text-center sm:p-7">
        <div className="mx-auto grid size-14 place-items-center border border-slate-900 bg-[#d3942b] font-serif text-2xl font-black">{verified ? "✓" : "@"}</div>
        <p className="section-kicker mt-4 justify-center">Kabar akun · Verifikasi</p>
        {verified === "1" ? (
          <>
            <h1 className="mt-2 text-2xl font-black">Email terverifikasi!</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Akun kamu sudah aktif. Mulai belanja sekarang.
            </p>
            <Link href="/products" className="btn-primary mt-5 w-full">
              Lihat Produk →
            </Link>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-2xl font-black">Silakan cek email kamu</h1>
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
          <div className="paper-heading">
            <p className="section-kicker">Belum menerima kabar?</p>
            <h2 className="mt-1 text-lg font-black">Kirim ulang link verifikasi</h2>
          </div>
          <div className="mt-4">
            <ResendForm />
          </div>
          <p className="mt-4 text-center text-sm text-slate-500">
            Sudah verifikasi?{" "}
            <Link href="/auth/login" className="paper-link font-semibold">
              Masuk sekarang
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
