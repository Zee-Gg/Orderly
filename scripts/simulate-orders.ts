/**
 * Create realistic test orders every few seconds through the REAL order
 * engine, so you can watch realtime updates, sounds and alerts.
 *
 *   npx tsx scripts/simulate-orders.ts <restaurant-slug> [options]
 *
 * Options:
 *   --branch "DHA Branch"   branch name (default: first branch)
 *   --every 8               seconds between orders (default 8)
 *   --count 10              how many orders (default 10)
 *   --status awaiting_acceptance | pending_confirmation | accepted (default awaiting_acceptance)
 *
 * Uses the secret key (acts like the WhatsApp bot will). Dev/test only.
 */
import { createClient } from "@supabase/supabase-js";
import { getBranchMenu, type BranchMenuItem } from "../src/lib/menu/pricing";
import type { OrderStatus } from "../src/lib/orders/constants";
import { createOrder } from "../src/lib/orders/engine";
import type { CartLineInput } from "../src/lib/orders/schemas";
import type { Database } from "../src/types/database";
import { requireDemoDataAllowed } from "./lib/demo-guard";

process.loadEnvFile(".env.local");
requireDemoDataAllowed("simulate:orders");

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const slug = process.argv[2];
if (!slug || slug.startsWith("--")) {
  console.error('Usage: npx tsx scripts/simulate-orders.ts <restaurant-slug> [--branch "Name"] [--every 8] [--count 10]');
  process.exit(1);
}
const every = Math.max(2, Number(arg("every", "8")));
const count = Math.max(1, Number(arg("count", "10")));
const status = arg("status", "awaiting_acceptance") as OrderStatus;

const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CUSTOMERS = [
  ["Fatima Noor", "0300-1112233"],
  ["Bilal Hussain", "0321-4455667"],
  ["Ayesha Khan", "0333-7788990"],
  ["Ahmed Raza", "0345-1231231"],
  ["Hira Malik", "0301-9876543"],
  ["Usman Ali", "0312-5551234"],
  ["Sana Javed", "0322-6667788"],
  ["Hamza Tariq", "0300-2223344"],
] as const;
const AREAS = [
  ["Gulberg III", "Near Liberty Market"],
  ["DHA Phase 5", "Behind Y block mosque"],
  ["Johar Town", "Near Emporium"],
  ["Bahria Town", "Sector C, near park"],
  ["Model Town", "Opposite Model Town Park"],
] as const;
const NOTES = ["", "", "", "Call at the gate", "Less spicy please", "Extra ketchup"];

const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/** A valid line: default/first size, cheapest valid choices for required groups. */
function lineFor(item: BranchMenuItem): CartLineInput {
  const size = item.sizes.find((s) => s.isDefault) ?? item.sizes[0];
  const optionIds: string[] = [];
  for (const g of item.groups) {
    const available = g.options.filter((o) => o.isAvailable);
    const defaults = available.filter((o) => o.isDefault).slice(0, g.maxSelect);
    const chosen = defaults.length >= g.minSelect ? defaults : available.slice(0, g.minSelect);
    if (g.minSelect === 0 && Math.random() < 0.3 && available[0]) chosen.push(available[0]);
    optionIds.push(...new Set(chosen.slice(0, g.maxSelect).map((o) => o.id)));
  }
  const removals = item.removableOptions.length && Math.random() < 0.2 ? [pick(item.removableOptions)] : [];
  return { itemId: item.id, variantId: size?.id ?? null, optionIds, removals, quantity: Math.random() < 0.7 ? 1 : 2, notes: "" };
}

async function main() {
  const { data: restaurant } = await db.from("restaurants").select("id, name").eq("slug", slug.toLowerCase()).maybeSingle();
  if (!restaurant) throw new Error(`No restaurant with slug "${slug}"`);
  const branchName = arg("branch", "");
  let branchQuery = db.from("branches").select("id, name").eq("restaurant_id", restaurant.id).eq("is_active", true).order("created_at");
  if (branchName) branchQuery = branchQuery.ilike("name", branchName);
  const { data: branches } = await branchQuery.limit(1);
  const branch = branches?.[0];
  if (!branch) throw new Error("Branch not found");

  const menu = await getBranchMenu(db, restaurant.id, branch.id);
  const sellable = menu.categories.flatMap((c) => c.items).filter((i) => i.isAvailable);
  if (!sellable.length) throw new Error("No items in stock. Seed a menu first: npm run seed:menu -- " + slug);

  console.log(`Simulating ${count} orders for ${restaurant.name} · ${branch.name}, one every ${every}s (status: ${status}). Ctrl+C to stop.\n`);

  for (let n = 1; n <= count; n++) {
    const [name, phone] = pick(CUSTOMERS);
    const orderType = pick(["delivery", "delivery", "pickup", "dine_in"] as const);
    const [area, landmark] = pick(AREAS);
    const lines = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => lineFor(pick(sellable)));

    const result = await createOrder(
      { admin: db, pricing: db },
      { restaurantId: restaurant.id, branchIds: null },
      {
        branchId: branch.id,
        idempotencyKey: `sim-${Date.now()}-${n}`,
        source: Math.random() < 0.7 ? "whatsapp" : "phone",
        orderType,
        paymentMethod: Math.random() < 0.85 ? "cod" : "bank_transfer",
        customer: { phone, name },
        address: orderType === "delivery" ? { addressText: `House ${10 + n}, Street ${n % 9 + 1}`, area, landmark, save: true } : undefined,
        tableNumber: orderType === "dine_in" ? String(1 + Math.floor(Math.random() * 12)) : "",
        notes: pick(NOTES),
        deliveryFee: orderType === "delivery" ? 15000 : 0,
        lines,
      },
      { type: "bot", userId: null, role: null },
      { initialStatus: status },
    );

    if (result.ok) {
      const { data } = await db.from("orders").select("total").eq("id", result.data.id).single();
      console.log(`  ✓ #${result.data.orderNumber}  ${name.padEnd(14)} ${orderType.padEnd(9)} Rs ${(data!.total / 100).toLocaleString("en-US")}`);
    } else {
      console.log(`  ✗ ${result.message}${result.lineErrors ? ` ${JSON.stringify(result.lineErrors[0]?.errors[0]?.code)}` : ""}`);
    }
    if (n < count) await new Promise((r) => setTimeout(r, every * 1000));
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
