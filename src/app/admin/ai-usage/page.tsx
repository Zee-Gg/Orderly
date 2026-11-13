import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { SkeletonList } from "@/components/ui/skeleton";
import { AdminNav } from "@/components/admin/admin-nav";
import { SimplePage } from "@/components/shell/simple-page";
import { requireSuperAdmin } from "@/lib/auth/session";
import { activeProvider, modelFor } from "@/lib/bot/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_TIMEZONE, monthStart, todayRange } from "@/lib/time";
import { AiUsageTable, type UsageRow } from "./ai-usage-table";

export const metadata: Metadata = { title: "AI usage" };

type Summary = { restaurant_id: string; conversations: number; bot_orders: number; input_tokens: number; output_tokens: number; cost: number };

/** Super admin only: AI cost per restaurant (platform time zone: Pakistan). */
async function Usage() {
  const user = await requireSuperAdmin();
  const db = createAdminClient();
  const [{ data: restaurants }, today, month] = await Promise.all([
    db.from("restaurants").select("id, name, slug, ai_monthly_budget_usd").order("name"),
    db.rpc("ai_usage_summary", { p_since: todayRange(DEFAULT_TIMEZONE).start.toISOString() }),
    db.rpc("ai_usage_summary", { p_since: monthStart(DEFAULT_TIMEZONE).toISOString() }),
  ]);
  const byId = (rows: Summary[] | null) => new Map((rows ?? []).map((r) => [r.restaurant_id, r]));
  const t = byId(today.data as Summary[] | null);
  const m = byId(month.data as Summary[] | null);
  const num = (v: unknown) => Number(v ?? 0);

  const rows: UsageRow[] = (restaurants ?? []).map((r) => {
    const d = t.get(r.id);
    const mo = m.get(r.id);
    const monthCost = num(mo?.cost);
    const monthOrders = num(mo?.bot_orders);
    const budget = r.ai_monthly_budget_usd === null ? null : num(r.ai_monthly_budget_usd);
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      today: { conversations: num(d?.conversations), orders: num(d?.bot_orders), tokens: num(d?.input_tokens) + num(d?.output_tokens), cost: num(d?.cost) },
      month: { conversations: num(mo?.conversations), orders: monthOrders, tokens: num(mo?.input_tokens) + num(mo?.output_tokens), cost: monthCost },
      costPerOrder: monthOrders ? monthCost / monthOrders : null,
      budgetUsd: budget,
      overBudget: budget !== null && monthCost >= budget,
    };
  });

  const provider = activeProvider();
  return (
    <SimplePage
      title="AI usage"
      subtitle={`${user.email ?? ""} · ${provider} · ${modelFor(provider)} · costs use the rates in src/lib/bot/config.ts`}
      actions={
        <Link href="/admin" className="flex min-h-touch items-center gap-1 px-2 text-sm font-semibold text-brand-700">
          <ArrowLeft aria-hidden className="size-4" /> Admin
        </Link>
      }
    >
      <AdminNav />
      <AiUsageTable rows={rows} />
    </SimplePage>
  );
}

export default function AiUsagePage() {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <Usage />
    </Suspense>
  );
}
