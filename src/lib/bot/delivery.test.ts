import { describe, expect, it } from "vitest";
import type { DeliveryZone } from "@/lib/delivery/zones";
import { buildMenuIndex, type MenuIndex } from "./menu-index";
import { BRANCH_ID, createMemoryBotStore, RESTAURANT_ID } from "./testing/memory-store";
import { runTool, type BotContext } from "./tools";
import type { BranchInfo } from "./types";

/** Phase 9: delivery zones in the chat — code decides fee + minimum; the summary uses them. */
const ZONES: DeliveryZone[] = [
  { id: "z-dha5", name: "DHA Phase 5", aliases: ["dha 5", "phase 5"], deliveryFee: 10000, minimumOrder: 150000, estimatedMinutes: 35, isActive: true },
  { id: "z-clifton", name: "Clifton", aliases: ["kehkashan"], deliveryFee: 20000, minimumOrder: 0, estimatedMinutes: 45, isActive: true },
];

async function setup(opts: { branch?: Partial<BranchInfo>; zones?: DeliveryZone[] } = {}) {
  const m = createMemoryBotStore({ zones: opts.zones ?? ZONES, branch: opts.branch });
  const customer = m.addCustomer({ name: "Ali" });
  const session = await m.store.createSession({ restaurantId: RESTAURANT_ID, branchId: BRANCH_ID, conversationId: null, customerId: customer.id, language: "roman_urdu" });
  let idx: MenuIndex | null = null;
  const ctx: BotContext = {
    store: m.store,
    session,
    restaurant: m.restaurant,
    branch: m.branch,
    customer,
    now: () => new Date(),
    menu: async () => (idx ??= buildMenuIndex(m.menu)),
    effects: { summary: null, order: null, handedOff: false, cancelled: false, media: [] },
  };
  const index = await ctx.menu();
  const ref = (name: string) => index.itemRef.get(m.itemIds[name])!;
  return { m, ctx, ref, run: (tool: string, input: unknown = {}) => runTool(ctx, tool, input) };
}

describe("delivery zones in the bot", () => {
  it("matched area → the zone's fee is in the summary and the order", async () => {
    const s = await setup();
    await s.run("add_to_cart", { item_id: s.ref("Chicken Karahi"), variant_id: "Full" }); // Rs 2,900
    const addr = await s.run("set_delivery_address", { address_text: "House 12, Street 4", area: "dha phase 5", landmark: "near masjid" });
    expect(addr).toMatchObject({ ok: true, delivery_area: "DHA Phase 5", delivery_fee: "Rs 100", minimum_order: "Rs 1,500", delivery_time: "about 35 minutes" });
    await s.run("set_payment_method", { payment_method: "cod" });
    const summary = await s.run("show_order_summary");
    expect(summary).toMatchObject({ ok: true, summary: { delivery_fee: "Rs 100", total: "Rs 3,000" } });
    const placed = await s.run("confirm_order");
    expect(placed.ok).toBe(true);
    expect(s.m.orders[0]).toMatchObject({ deliveryFee: 10000 });
  });

  it("below the zone minimum → says how much more to add", async () => {
    const s = await setup();
    await s.run("add_to_cart", { item_id: s.ref("Zinger Burger") }); // Rs 550
    await s.run("set_delivery_address", { address_text: "House 1, DHA 5", landmark: "near park" });
    await s.run("set_payment_method", { payment_method: "cod" });
    expect(await s.run("show_order_summary")).toMatchObject({
      ok: false,
      error: "NOT_READY",
      missing: ["minimum_order"],
      minimum_order: "Rs 1,500",
      add_at_least: "Rs 950",
    });
  });

  it("area not served (policy reject) → out of range, offer pickup; no summary", async () => {
    const s = await setup({ branch: { unlistedAreaPolicy: "reject" } });
    await s.run("add_to_cart", { item_id: s.ref("Zinger Burger"), quantity: 2 });
    expect(await s.run("set_delivery_address", { address_text: "Plot 9, Korangi", area: "Korangi", landmark: "near bridge" })).toMatchObject({
      ok: false,
      error: "OUT_OF_RANGE",
      say: "Maazrat, is area mein delivery nahi hoti. Kya aap pickup karna chahenge?",
    });
    await s.run("set_payment_method", { payment_method: "cod" });
    expect(await s.run("show_order_summary")).toMatchObject({ ok: false, error: "OUT_OF_RANGE" });
    // Switching to pickup works.
    await s.run("set_order_type", { order_type: "pickup" });
    expect(await s.run("show_order_summary")).toMatchObject({ ok: true, summary: { delivery_fee: "Rs 0" } });
  });

  it("pin farther than the max radius → out of range", async () => {
    const s = await setup({ branch: { maxDeliveryRadiusKm: 5 } });
    await s.run("add_to_cart", { item_id: s.ref("Zinger Burger"), quantity: 3 });
    expect(await s.run("set_delivery_address", { address_text: "Gulshan block 13", latitude: 24.9375, longitude: 67.0753 })).toMatchObject({ error: "OUT_OF_RANGE" });
  });

  it("unlisted area with the default-fee policy → branch fee, order flagged for a check", async () => {
    const s = await setup();
    await s.run("add_to_cart", { item_id: s.ref("Zinger Burger"), quantity: 2 });
    expect(await s.run("set_delivery_address", { address_text: "Flat 2, Saddar", area: "Saddar", landmark: "near Empress Market" })).toMatchObject({
      ok: true,
      delivery_fee: "Rs 150",
    });
    await s.run("set_payment_method", { payment_method: "cod" });
    await s.run("show_order_summary");
    await s.run("confirm_order");
    expect(s.m.orders[0].riskFlag).toBe("Area not in list — check");
  });
});
