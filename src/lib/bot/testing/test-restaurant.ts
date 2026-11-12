import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { seedDemoKnowledge, seedDemoMenu } from "@/lib/menu/demo-menu-seed";
import type { Database } from "@/types/database";

/**
 * A throwaway restaurant with the demo menu for bot tests and the eval:
 *  - "Clifton" branch: open 24h, delivery fee Rs 150, minimum order Rs 500
 *    (Loaded Fries is out of stock here)
 *  - "Night Branch": switched off (closed)
 *  - Phase 7C knowledge: Friday Deal + Student Deal offers, 5 FAQs, Clifton pin
 * Scripts/tests only (service-role client). Call cleanup() at the end.
 */
export type BotTestRestaurant = {
  restaurantId: string;
  openBranchId: string;
  closedBranchId: string;
  ownerId: string;
  itemIds: Record<string, string>;
  /** A new customer (no orders). */
  newCustomer(opts?: { name?: string | null; phone?: string }): Promise<string>;
  cleanup(): Promise<void>;
};

const ALL_DAY = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { closed: false, open: "00:00", close: "23:59" }]),
);

let phoneSeq = 0;

export async function createBotTestRestaurant(
  admin: SupabaseClient<Database>,
  env: { url: string; publishableKey: string },
  label: string,
): Promise<BotTestRestaurant> {
  const run = `${label}-${Date.now().toString(36)}`;
  const email = `bot-${run}@example.com`;
  const password = `Bot-${run}-Aa1!`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created.user) throw error ?? new Error("createUser failed");
  const ownerId = created.user.id;

  const client = createClient<Database>(env.url, env.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const { data: restaurantId, error: rErr } = await client.rpc("create_restaurant_with_owner", {
    p_name: "Cheezious Test",
    p_slug: `bot-${run}`.slice(0, 40),
    p_city: "Karachi",
    p_phone: "03001234567",
    p_branch_name: "Clifton",
    p_branch_address: "Block 5, Clifton",
    p_branch_area: "Clifton",
    p_opening_hours: ALL_DAY,
  });
  if (rErr || !restaurantId) throw rErr ?? new Error("create restaurant failed");

  const { data: open } = await admin.from("branches").select("id").eq("restaurant_id", restaurantId).single();
  if (!open) throw new Error("branch missing");
  await admin.from("branches").update({ default_delivery_fee: 15000, minimum_order: 50000, is_open: true }).eq("id", open.id);
  const { data: closed, error: cErr } = await admin
    .from("branches")
    .insert({ restaurant_id: restaurantId, name: "Night Branch", address: "Main Boulevard", area: "Gulberg", is_open: false, opening_hours: ALL_DAY })
    .select("id")
    .single();
  if (cErr || !closed) throw cErr ?? new Error("closed branch failed");

  const itemIds = await seedDemoMenu(admin, restaurantId, open.id);
  await seedDemoKnowledge(admin, restaurantId, open.id, itemIds);

  return {
    restaurantId,
    openBranchId: open.id,
    closedBranchId: closed.id,
    ownerId,
    itemIds,
    async newCustomer(opts = {}) {
      phoneSeq++;
      const phone = opts.phone ?? `+92300${String(Date.now() % 10_000_000).padStart(7, "0").slice(0, 4)}${String(phoneSeq).padStart(3, "0")}`;
      const { data, error: e } = await admin
        .from("customers")
        .insert({ restaurant_id: restaurantId, phone, name: opts.name ?? null })
        .select("id")
        .single();
      if (e || !data) throw e ?? new Error("customer failed");
      return data.id;
    },
    async cleanup() {
      await admin.from("restaurants").delete().eq("id", restaurantId);
      await admin.auth.admin.deleteUser(ownerId);
    },
  };
}
