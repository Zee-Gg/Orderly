import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { DEMO_BRANCH_LOCATION, DEMO_FAQS, DEMO_GROUPS, DEMO_MENU, DEMO_OFFERS, type DemoGroupKey } from "./demo-menu";

/**
 * Insert the demo menu into a restaurant (service-role client; scripts and
 * tests only). Loaded Fries is marked out of stock at `outOfStockBranchId`.
 * Returns item ids by name.
 */
const rs = (rupees: number) => rupees * 100; // → paisa

function must<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`${what}: ${result.error?.message ?? "not found"}`);
  }
  return result.data;
}

export async function seedDemoMenu(
  db: SupabaseClient<Database>,
  restaurantId: string,
  outOfStockBranchId: string,
): Promise<Record<string, string>> {
  const groupIds = {} as Record<DemoGroupKey, string>;
  let gi = 0;
  for (const [key, g] of Object.entries(DEMO_GROUPS) as [DemoGroupKey, (typeof DEMO_GROUPS)[DemoGroupKey]][]) {
    const group = must(
      await db
        .from("modifier_groups")
        .insert({ restaurant_id: restaurantId, name: g.name, name_ur: g.nameUr ?? null, min_select: g.min, max_select: g.max, sort_order: gi++ })
        .select("id")
        .single(),
      `Group ${g.name}`,
    );
    groupIds[key] = group.id;
    must(
      await db
        .from("modifier_options")
        .insert(
          g.options.map(([name, price, isDefault], i) => ({
            restaurant_id: restaurantId,
            group_id: group.id,
            name,
            price_delta: rs(price),
            is_default: !!isDefault,
            sort_order: i,
          })),
        )
        .select("id"),
      `Options for ${g.name}`,
    );
  }

  const itemIds: Record<string, string> = {};
  for (const [ci, cat] of DEMO_MENU.entries()) {
    const category = must(
      await db
        .from("menu_categories")
        .insert({ restaurant_id: restaurantId, name: cat.name, name_ur: cat.nameUr ?? null, sort_order: ci })
        .select("id")
        .single(),
      `Category ${cat.name}`,
    );
    for (const [ii, it] of cat.items.entries()) {
      const item = must(
        await db
          .from("menu_items")
          .insert({
            restaurant_id: restaurantId,
            category_id: category.id,
            name: it.name,
            name_ur: it.nameUr ?? null,
            description: it.description,
            base_price: it.price !== undefined ? rs(it.price) : null,
            sort_order: ii,
            tags: it.tags ?? [],
            prep_time_minutes: it.prep ?? null,
            aliases: it.aliases,
            removable_options: it.removable ?? [],
          })
          .select("id")
          .single(),
        `Item ${it.name}`,
      );
      itemIds[it.name] = item.id;
      if (it.sizes) {
        must(
          await db
            .from("item_variants")
            .insert(
              it.sizes.map(([name, price, isDefault], i) => ({
                restaurant_id: restaurantId,
                item_id: item.id,
                name,
                price: rs(price),
                is_default: !!isDefault,
                sort_order: i,
              })),
            )
            .select("id"),
          `Sizes for ${it.name}`,
        );
      }
      if (it.groups?.length) {
        must(
          await db
            .from("item_modifier_groups")
            .insert(it.groups.map((g, i) => ({ restaurant_id: restaurantId, item_id: item.id, group_id: groupIds[g], sort_order: i })))
            .select("item_id"),
          `Extras for ${it.name}`,
        );
      }
      if (it.outOfStockAtFirstBranch) {
        must(
          await db
            .from("branch_item_settings")
            .insert({ restaurant_id: restaurantId, branch_id: outOfStockBranchId, item_id: item.id, is_available: false })
            .select("item_id"),
          `Stock for ${it.name}`,
        );
      }
    }
  }
  return itemIds;
}

/**
 * Phase 7C demo knowledge: the two offers, five FAQs, and the first branch's
 * address + pin (only filled when the branch has none). No images.
 */
export async function seedDemoKnowledge(
  db: SupabaseClient<Database>,
  restaurantId: string,
  firstBranchId: string,
  itemIds: Record<string, string>,
): Promise<void> {
  must(
    await db
      .from("offers")
      .insert(
        DEMO_OFFERS.map((o, i) => ({
          restaurant_id: restaurantId,
          title: o.title,
          title_ur: o.titleUr ?? null,
          description: o.description,
          menu_item_id: itemIds[o.itemName],
          days_of_week: o.daysOfWeek,
          start_time: o.startTime,
          end_time: o.endTime,
          starts_at: "2026-01-01T00:00:00Z",
          sort_order: i,
        })),
      )
      .select("id"),
    "Offers",
  );
  must(
    await db
      .from("restaurant_faqs")
      .insert(DEMO_FAQS.map((f, i) => ({ restaurant_id: restaurantId, question: f.question, answer: f.answer, keywords: f.keywords, sort_order: i })))
      .select("id"),
    "FAQs",
  );
  const branch = must(await db.from("branches").select("address, latitude").eq("id", firstBranchId).single(), "Branch");
  must(
    await db
      .from("branches")
      .update({
        ...(branch.address ? {} : { address: DEMO_BRANCH_LOCATION.address, area: DEMO_BRANCH_LOCATION.area }),
        ...(branch.latitude != null ? {} : { latitude: DEMO_BRANCH_LOCATION.latitude, longitude: DEMO_BRANCH_LOCATION.longitude }),
      })
      .eq("id", firstBranchId)
      .select("id"),
    "Branch location",
  );
}
