/**
 * Seed a realistic Pakistani demo menu into an existing restaurant.
 *
 *   npx tsx scripts/seed-demo-menu.ts <restaurant-slug>
 *
 * Refuses to run if the restaurant already has menu categories.
 * Uses the secret key (bypasses RLS) — local/dev use only.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import { DEMO_GROUPS, DEMO_MENU } from "../src/lib/menu/demo-menu";
import { seedDemoKnowledge, seedDemoMenu } from "../src/lib/menu/demo-menu-seed";
import { requireDemoDataAllowed } from "./lib/demo-guard";

process.loadEnvFile(".env.local");
requireDemoDataAllowed("seed:menu");
const slug = process.argv[2];
if (!slug) {
  console.error("Usage: npx tsx scripts/seed-demo-menu.ts <restaurant-slug>");
  process.exit(1);
}

const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: restaurant } = await db.from("restaurants").select("id, name").eq("slug", slug.toLowerCase()).maybeSingle();
  if (!restaurant) throw new Error(`Restaurant "${slug}" not found`);

  const { count } = await db
    .from("menu_categories")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant.id)
    .is("archived_at", null); // archived categories don't count as a menu
  if ((count ?? 0) > 0) {
    console.error(`${restaurant.name} already has a menu (${count} categories). Not seeding.`);
    process.exit(1);
  }

  const { data: branch } = await db.from("branches").select("id, name").eq("restaurant_id", restaurant.id).order("created_at").limit(1).single();
  if (!branch) throw new Error("First branch not found");

  const items = await seedDemoMenu(db, restaurant.id, branch.id);
  console.log(
    `Seeded ${restaurant.name}: ${DEMO_MENU.length} categories, ${Object.keys(items).length} items, ${Object.keys(DEMO_GROUPS).length} extras groups.`,
  );
  console.log(`Loaded Fries is out of stock at ${branch.name}.`);
  await seedDemoKnowledge(db, restaurant.id, branch.id, items);
  console.log("Added the Friday Deal + Student Deal offers, 5 FAQs, and a location for the first branch (if it had none).");
}

main().catch((err) => {
  console.error("Seeding failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
