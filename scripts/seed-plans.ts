/**
 * Create the default subscription plans — ONLY if there are no plans yet.
 * Safe to run on the live database (it never changes or deletes anything).
 *
 *   npm run seed:plans
 *
 * Prices are a starting point: change them any time in /admin/settings.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";

process.loadEnvFile(".env.local");

const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Amounts in paisa (Rs 4,999 = 499_900).
const DEFAULT_PLANS: Database["public"]["Tables"]["plans"]["Insert"][] = [
  {
    name: "Starter",
    description: "One branch, WhatsApp bot, orders dashboard and kitchen screen.",
    monthly_price: 4_999_00,
    max_branches: 1,
    max_orders_per_month: 1500,
    max_bot_conversations_per_month: 1500,
    sort_order: 1,
  },
  {
    name: "Growth",
    description: "Up to 3 branches, riders, reports and the menu page.",
    monthly_price: 9_999_00,
    max_branches: 3,
    max_orders_per_month: 5000,
    max_bot_conversations_per_month: 5000,
    sort_order: 2,
  },
  {
    name: "Pro",
    description: "Up to 10 branches with no order limits.",
    monthly_price: 19_999_00,
    max_branches: 10,
    max_orders_per_month: null,
    max_bot_conversations_per_month: null,
    sort_order: 3,
  },
];

async function main() {
  const { count, error } = await db.from("plans").select("id", { count: "exact", head: true });
  if (error) throw error;
  if ((count ?? 0) > 0) {
    console.log(`There are already ${count} plan(s). Nothing changed. Edit plans in /admin/settings.`);
    return;
  }
  const { error: insertError } = await db.from("plans").insert(DEFAULT_PLANS);
  if (insertError) throw insertError;
  console.log(`Created ${DEFAULT_PLANS.length} plans: ${DEFAULT_PLANS.map((p) => p.name).join(", ")}.`);

  // Restaurants without a plan get the first one (their trial dates stay as they are).
  const { data: first } = await db.from("plans").select("id").order("sort_order").limit(1).single();
  if (first) {
    const { data: updated } = await db.from("restaurant_subscriptions").update({ plan_id: first.id }).is("plan_id", null).select("restaurant_id");
    console.log(`Gave the Starter plan to ${updated?.length ?? 0} restaurant(s) that had none.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
