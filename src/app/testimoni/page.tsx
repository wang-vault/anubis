import type { Metadata } from "next";
import Link from "next/link";
import { listCompletedTestimonials, TESTIMONIAL_LIMIT } from "@/lib/testimonials";
import { formatDateId } from "@/lib/dates";
import { getAuthContext } from "@/lib/authz";
import { EmptyState } from "@/components/UiBits";

export const metadata: Metadata = {
  title: "Testimoni",
  description:
    "Kabar pesanan yang telah selesai — dirangkum otomatis dari pesanan terbaru yang ditandai selesai oleh penjual.",
};

/**
 * Halaman testimoni OTOMATIS — PUBLIK (bisa dibaca tanpa akun, tidak
 * di-gate middleware). Data: maksimal TESTIMONIAL_LIMIT pesanan dengan
 * order_status DONE, tanpa data pribadi (lihat lib/testimonials.ts).
 */
export default async function TestimonialsPage() {
  const [items, ctx] = await Promise.all([listCompletedTestimonials(), getAuthContext()]);

  return (
    <div className="container-x max-w-4xl">
      <div className="paper-heading">
        <p className="section-kicker">Kabar pembaca · Pesanan selesai</p>
        <h1 className="paper-heading-title">Testimoni pembeli</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Halaman ini terbuka untuk siapa saja — termasuk yang belum punya akun. Daftarnya
          dibuat <strong>otomatis</strong> dari maksimal {TESTIMONIAL_LIMIT} pesanan terakhir
          yang ditandai <strong>selesai</strong> oleh penjual, tak lama setelah pesanan itu
          rampung.
        </p>
      </div>

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState
            icon="✓"
            title="Belum ada pesanan selesai"
            desc="Testimoni akan muncul di sini secara otomatis setelah penjual menandai pesanan selesai. Jadilah pembeli pertama!"
            action={
              <Link href="/products" className="btn-primary">
                Lihat Katalog →
              </Link>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((t, i) => (
              <article key={`${t.name}-${t.completedAt}-${i}`} className="card flex flex-col p-5">
                <div className="flex items-center justify-between">
                  <span
                    className="grid size-9 place-items-center border border-slate-900 bg-[#d3942b] font-serif text-base font-black text-slate-900"
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    Pesanan selesai
                  </span>
                </div>
                <p className="mt-3 font-serif text-lg font-black leading-snug">{t.name}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  telah menerima pesanannya:{" "}
                  <strong className="text-slate-900">{t.productName}</strong>
                  {t.quantity > 1 && <> (×{t.quantity})</>}
                </p>
                <p className="mt-auto pt-3 text-xs font-semibold text-slate-400">
                  {formatDateId(t.completedAt)}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>

      <section className="paper-inset mt-8 grid gap-3 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-5">
        <span
          className="grid size-11 place-items-center border border-slate-900 bg-slate-900 font-serif text-xl font-black text-white"
          aria-hidden
        >
          ”
        </span>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-brand-700">
            Kabar baik berikutnya
          </p>
          <p className="mt-1 font-serif text-sm leading-6 text-slate-700">
            Belanja sekarang — pesananmu yang selesai akan ikut tercatat di halaman ini.
          </p>
        </div>
        {ctx ? (
          <Link href="/products" className="btn-secondary btn-sm justify-self-start sm:justify-self-end">
            Lihat Katalog →
          </Link>
        ) : (
          <Link href="/auth/register" className="btn-secondary btn-sm justify-self-start sm:justify-self-end">
            Buat Akun Gratis
          </Link>
        )}
      </section>

      <p className="hint mt-4">
        Privasi: nama pembeli ditulis singkat (mis. “Budi S.”). Tidak ada nomor WhatsApp,
        email, kode pesanan, atau nominal yang ditampilkan di halaman ini.
      </p>
    </div>
  );
}
