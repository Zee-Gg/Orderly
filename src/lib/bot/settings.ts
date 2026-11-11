import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { monthStart, todayRange } from "@/lib/time";

/** Bot settings + today's numbers for /settings/whatsapp (after a permission check). */
export async function getBotOverview(restaurantId: string, timezone: string) {
  const supabase = await createClient();
  const { start, end } = todayRange(timezone);
  const [restaurant, sessions, orders] = await Promise.all([
    supabase.from("restaurants").select("bot_enabled, high_value_cod_threshold").eq("id", restaurantId).single(),
    supabase
      .from("bot_sessions")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString()),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("source", "whatsapp")
      .is("created_by", null)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString()),
  ]);
  // Budget + spend are platform data (service role): read-only here.
  const admin = createAdminClient();
  const [budgetRow, usage] = await Promise.all([
    admin.from("restaurants").select("ai_monthly_budget_usd").eq("id", restaurantId).single(),
    admin.rpc("ai_usage_summary", { p_since: monthStart(timezone).toISOString(), p_restaurant_id: restaurantId }),
  ]);
  const budget = budgetRow.data?.ai_monthly_budget_usd;
  const spent = Number(usage.data?.[0]?.cost ?? 0);
  return {
    botEnabled: restaurant.data?.bot_enabled ?? true,
    highValueCodThreshold: restaurant.data?.high_value_cod_threshold ?? 500000,
    conversationsToday: sessions.count ?? 0,
    botOrdersToday: orders.count ?? 0,
    budgetUsd: budget === null || budget === undefined ? null : Number(budget),
    spentThisMonthUsd: spent,
    overBudget: budget !== null && budget !== undefined && spent >= Number(budget),
  };
}
