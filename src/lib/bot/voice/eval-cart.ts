import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { runBotTurn } from "../agent";
import { createSupabaseBotStore } from "../store";
import { createBotTestRestaurant, type BotTestRestaurant } from "../testing/test-restaurant";
import { VOICE_MARKER } from "./handle";
import type { CartCheck } from "./eval";

/**
 * For voice tests with expected items: feed the transcript to the REAL bot
 * (as a voice note) on a throwaway restaurant with the demo menu and compare
 * the cart. Call `cleanup()` when done. Development/eval only.
 */
export async function createVoiceCartChecker(
  admin: SupabaseClient<Database>,
  env: { url: string; publishableKey: string },
): Promise<{ check: CartCheck; cleanup: () => Promise<void> }> {
  let t: BotTestRestaurant | null = null;
  const store = createSupabaseBotStore(admin);
  const norm = (s: string) => s.trim().toLowerCase();
  return {
    async check(transcript, expected) {
      t ??= await createBotTestRestaurant(admin, env, "voice");
      const customerId = await t.newCustomer({ name: "Voice Test" });
      const r = await runBotTurn(
        {
          restaurantId: t.restaurantId,
          branchId: t.openBranchId,
          sessionId: null,
          customerId,
          customerMessages: [`${VOICE_MARKER} ${transcript}`],
          voice: true,
        },
        { store },
      );
      const cart = r.session.cart.map((l) => `${l.quantity}× ${l.name}${l.sizeName ? ` (${l.sizeName})` : ""}`);
      const missing = expected.filter((e) => !r.session.cart.some((l) => norm(l.name) === norm(e.item) && l.quantity === e.qty));
      const extra = r.session.cart.filter((l) => !expected.some((e) => norm(e.item) === norm(l.name)));
      const problem = r.error
        ? `AI ${r.error.type}: ${r.error.message.slice(0, 120)}`
        : missing.length || extra.length
          ? [missing.length ? `missing ${missing.map((m) => `${m.qty}× ${m.item}`).join(", ")}` : "", extra.length ? `extra ${extra.map((l) => l.name).join(", ")}` : ""]
              .filter(Boolean)
              .join("; ")
          : null;
      return { pass: !problem, cart, problem };
    },
    async cleanup() {
      if (t) await t.cleanup();
      t = null;
    },
  };
}
