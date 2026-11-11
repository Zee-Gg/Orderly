/**
 * Turn staff corrections of bot orders (ai_corrections) into eval cases.
 *
 *   npm run export:corrections [-- --since 2026-11-01] [--restaurant <slug>]
 *
 * Each case replays the customer's messages from the bot session and expects
 * the cart staff ended up with. Saved to tests/bot-eval/corrections/<date>.json.
 * The eval runs against the DEMO menu: cases whose items are all on the demo
 * menu are marked `demo_menu: true` and can run as-is:
 *   npm run eval:bot -- --cases tests/bot-eval/corrections/<date>.json
 * Others are kept for review (rewrite them with demo menu items, or add them to cases.json).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import type { OrderSnapshot } from "../src/lib/bot/corrections";
import type { TranscriptEntry } from "../src/lib/bot/types";
import { DEMO_MENU } from "../src/lib/menu/demo-menu";

process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const since = flag("since");
const slug = flag("restaurant");

const db: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const demoItems = new Set(DEMO_MENU.flatMap((c) => c.items.map((i) => i.name)));

async function main() {
  let restaurantId: string | null = null;
  if (slug) {
    const { data } = await db.from("restaurants").select("id").eq("slug", slug).maybeSingle();
    if (!data) throw new Error(`No restaurant "${slug}"`);
    restaurantId = data.id;
  }
  let q = db
    .from("ai_corrections")
    .select("id, created_at, before, after, restaurant:restaurants(slug), session:bot_sessions(transcript)")
    .order("created_at");
  if (since) q = q.gte("created_at", new Date(since).toISOString());
  if (restaurantId) q = q.eq("restaurant_id", restaurantId);
  const { data, error } = await q;
  if (error) throw error;

  const cases = (data ?? []).flatMap((c) => {
    const transcript = (c.session?.transcript ?? []) as unknown as TranscriptEntry[];
    const turns = transcript.filter((e) => e.role === "customer" && e.text.trim()).map((e) => [e.text]);
    if (!turns.length) return [];
    const after = c.after as unknown as OrderSnapshot;
    const before = c.before as unknown as OrderSnapshot;
    return [
      {
        id: `corr-${c.id.slice(0, 8)}`,
        category: "correction",
        description: `Staff corrected a bot order (${c.restaurant?.slug ?? "?"}, ${c.created_at.slice(0, 10)}). Bot had: ${before.lines
          .map((l) => `${l.quantity}× ${l.item}${l.size ? ` (${l.size})` : ""}`)
          .join(", ")}`,
        demo_menu: after.lines.every((l) => demoItems.has(l.item)),
        turns,
        expect: {
          cart: after.lines.map((l) => ({
            item: l.item,
            qty: l.quantity,
            ...(l.size ? { size: l.size } : {}),
            ...(l.extras.length ? { extras: l.extras } : {}),
            ...(l.removals.length ? { removals: l.removals } : {}),
          })),
        },
      },
    ];
  });

  mkdirSync("tests/bot-eval/corrections", { recursive: true });
  const file = `tests/bot-eval/corrections/${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, `${JSON.stringify(cases, null, 2)}\n`);
  const ready = cases.filter((c) => c.demo_menu).length;
  console.log(`Exported ${cases.length} correction case(s) → ${file}`);
  console.log(`${ready} use only demo-menu items and can run now: npm run eval:bot -- --cases ${file}`);
  if (cases.length - ready) console.log(`${cases.length - ready} use the restaurant's own items: review and rewrite them for the demo menu.`);
}

main().catch((err) => {
  console.error("Export failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
