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

process.loadEnvFile(".env.local");
const slug = process.argv[2];
if (!slug) {
  console.error("Usage: npx tsx scripts/seed-demo-menu.ts <restaurant-slug>");
  process.exit(1);
}

const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rs = (rupees: number) => rupees * 100; // → paisa

type GroupKey = "pizzaExtras" | "drink" | "spice";

type SeedItem = {
  name: string;
  nameUr?: string;
  description: string;
  price?: number;
  sizes?: [name: string, rupees: number, isDefault?: boolean][];
  groups?: GroupKey[];
  removable?: string[];
  aliases: string[];
  tags?: Database["public"]["Tables"]["menu_items"]["Insert"]["tags"];
  prep?: number;
  outOfStockAtFirstBranch?: boolean;
};

const MENU: { name: string; nameUr?: string; items: SeedItem[] }[] = [
  {
    name: "Pizza",
    nameUr: "پیزا",
    items: [
      {
        name: "Chicken Tikka Pizza",
        nameUr: "چکن تکہ پیزا",
        description: "Tikka chicken, onion, capsicum, olives, mozzarella",
        sizes: [["Small", 899], ["Medium", 1399, true], ["Large", 1850]],
        groups: ["pizzaExtras"],
        removable: ["Onion", "Olives", "Capsicum"],
        aliases: ["tikka pizza", "chicken tikka", "tikka", "تکہ پیزا"],
        tags: ["bestseller"],
        prep: 20,
      },
      {
        name: "Fajita Pizza",
        description: "Fajita chicken, onion, capsicum, mozzarella",
        sizes: [["Small", 949], ["Medium", 1449, true], ["Large", 1899]],
        groups: ["pizzaExtras"],
        removable: ["Onion", "Capsicum"],
        aliases: ["fajita", "fajeta", "chicken fajita", "فجیتا"],
        tags: ["spicy"],
        prep: 20,
      },
    ],
  },
  {
    name: "Burgers",
    nameUr: "برگر",
    items: [
      {
        name: "Zinger Burger",
        nameUr: "زنگر برگر",
        description: "Crispy chicken fillet, lettuce, mayo",
        price: 550,
        removable: ["Mayo", "Lettuce"],
        aliases: ["zinger", "zngr", "zinger burger", "zingr", "زنگر"],
        tags: ["bestseller"],
        prep: 10,
      },
      {
        name: "Beef Smash Burger",
        description: "Double smashed beef, cheese, house sauce",
        price: 850,
        removable: ["Onion", "Pickles", "Cheese"],
        aliases: ["smash burger", "beef burger", "smash", "smashed burger"],
        tags: ["new"],
        prep: 12,
      },
      {
        name: "Zinger Deal",
        description: "Zinger Burger, regular fries and a drink",
        price: 799,
        groups: ["drink"],
        removable: ["Mayo"],
        aliases: ["zinger deal", "zinger meal", "deal", "ڈیل"],
        tags: ["deal"],
        prep: 12,
      },
    ],
  },
  {
    name: "Desi",
    nameUr: "دیسی",
    items: [
      {
        name: "Chicken Karahi",
        nameUr: "چکن کڑاہی",
        description: "Fresh tomato and green chilli karahi, made to order",
        sizes: [["Half", 1600], ["Full", 2900, true]],
        groups: ["spice"],
        aliases: ["karahi", "karai", "kadai", "chicken karai", "کڑاہی"],
        tags: ["popular"],
        prep: 30,
      },
    ],
  },
  {
    name: "Rice",
    nameUr: "چاول",
    items: [
      {
        name: "Chicken Biryani",
        nameUr: "چکن بریانی",
        description: "Sindhi-style biryani with raita and salad",
        price: 450,
        groups: ["spice"],
        removable: ["Aloo"],
        aliases: ["biryani", "biriyani", "briyani", "chicken biryani", "بریانی"],
        tags: ["bestseller", "spicy"],
        prep: 10,
      },
    ],
  },
  {
    name: "Sides",
    items: [
      {
        name: "Loaded Fries",
        description: "Fries, cheese sauce, jalapeños, mayo",
        price: 450,
        removable: ["Jalapeños", "Mayo"],
        aliases: ["loaded", "loaded fries", "cheese fries", "fries"],
        prep: 8,
        outOfStockAtFirstBranch: true,
      },
      {
        name: "Garlic Naan",
        nameUr: "گارلک نان",
        description: "Fresh tandoori naan with garlic butter",
        price: 120,
        aliases: ["naan", "nan", "garlic nan", "garlic naan", "نان"],
        tags: ["vegetarian"],
        prep: 5,
      },
      {
        name: "Raita",
        nameUr: "رائتہ",
        description: "Yogurt with mint and cucumber",
        price: 80,
        aliases: ["raita", "raitha", "dahi", "رائتہ"],
        tags: ["vegetarian"],
      },
    ],
  },
  {
    name: "Drinks",
    nameUr: "مشروبات",
    items: [
      {
        name: "Mint Margarita",
        description: "Fresh mint, lemon and soda",
        price: 350,
        aliases: ["mint marg", "margarita", "mint margarita", "mint lemonade"],
        tags: ["vegetarian"],
      },
      {
        name: "Coke 1.5L",
        description: "Chilled Coca-Cola, 1.5 litre",
        price: 250,
        aliases: ["coke", "coca cola", "cold drink", "1.5 coke", "big coke", "کوک"],
      },
    ],
  },
];

const GROUPS: Record<GroupKey, { name: string; nameUr?: string; min: number; max: number; options: [string, number, boolean?][] }> = {
  pizzaExtras: {
    name: "Pizza Extras",
    min: 0,
    max: 3,
    options: [["Extra Cheese", 150], ["Jalapeños", 100], ["Extra Sauce", 50]],
  },
  drink: {
    name: "Choose your drink",
    nameUr: "مشروب منتخب کریں",
    min: 1,
    max: 1,
    options: [["Coke", 0], ["Sprite", 0], ["Mint Margarita", 100]],
  },
  spice: {
    name: "Spice level",
    nameUr: "مرچ",
    min: 1,
    max: 1,
    options: [["Mild", 0], ["Medium", 0, true], ["Spicy", 0]],
  },
};

function must<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`${what}: ${result.error?.message ?? "not found"}`);
  }
  return result.data;
}

async function main() {
  const restaurant = must(
    await db.from("restaurants").select("id, name").eq("slug", slug.toLowerCase()).maybeSingle(),
    `Restaurant "${slug}"`,
  );
  const restaurantId = restaurant.id;

  const { count } = await db
    .from("menu_categories")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId);
  if ((count ?? 0) > 0) {
    console.error(`${restaurant.name} already has a menu (${count} categories). Not seeding.`);
    process.exit(1);
  }

  const branch = must(
    await db.from("branches").select("id, name").eq("restaurant_id", restaurantId).order("created_at").limit(1).single(),
    "First branch",
  );

  // Reusable extras groups
  const groupIds = {} as Record<GroupKey, string>;
  let gi = 0;
  for (const [key, g] of Object.entries(GROUPS) as [GroupKey, (typeof GROUPS)[GroupKey]][]) {
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

  let itemCount = 0;
  for (const [ci, cat] of MENU.entries()) {
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
      itemCount++;

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
            .insert({ restaurant_id: restaurantId, branch_id: branch.id, item_id: item.id, is_available: false })
            .select("item_id"),
          `Stock for ${it.name}`,
        );
      }
    }
  }

  console.log(
    `Seeded ${restaurant.name}: ${MENU.length} categories, ${itemCount} items, ${Object.keys(GROUPS).length} extras groups.`,
  );
  console.log(`Loaded Fries is out of stock at ${branch.name}.`);
}

main().catch((err) => {
  console.error("Seeding failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
