import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/authz";
import { AiUsagePanel } from "@/components/admin/AiUsagePanel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Monitoring Token AI" };

/**
 * /admin/ai-usage — monitoring pemakaian token & biaya AI (LiteLLM).
 * Gate role diulang di sini (defense-in-depth) meski layout panel sudah
 * memeriksa; API route juga memeriksa ulang lewat requireAdmin().
 */
export default async function AdminAiUsagePage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/auth/login?next=/admin/ai-usage");
  if (ctx.profile?.role !== "admin") redirect("/auth/login?error=not_admin");

  return (
    <div className="container-x space-y-6">
      <div className="paper-heading">
        <p className="eyebrow">Kantor redaksi · Pemakaian AI</p>
        <h1 className="paper-heading-title font-serif">Monitoring token AI</h1>
        <p className="mt-2 text-sm text-slate-500">
          Pantau konsumsi token, biaya, dan status tiap request yang melewati LiteLLM.
        </p>
      </div>

      <AiUsagePanel />
    </div>
  );
}
