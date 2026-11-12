import { describe, expect, it } from "vitest";
import { computeStage, summaryHash } from "./cart";
import { detectLanguage } from "./language";
import { buildMenuIndex, type MenuIndex } from "./menu-index";
import { searchMenu } from "./search";
import { BRANCH_ID, createMemoryBotStore, RESTAURANT_ID } from "./testing/memory-store";
import { runTool, type BotContext } from "./tools";
import type { BranchInfo, CustomerInfo, RestaurantInfo } from "./types";

async function setup(opts: { branch?: Partial<BranchInfo>; restaurant?: Partial<RestaurantInfo>; customer?: Partial<CustomerInfo> } = {}) {
  const m = createMemoryBotStore(opts);
  const customer = m.addCustomer({ name: "Ali", ...opts.customer });
  const session = await m.store.createSession({
    restaurantId: RESTAURANT_ID,
    branchId: BRANCH_ID,
    conversationId: null,
    customerId: customer.id,
    language: "roman_urdu",
  });
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
  const run = (tool: string, input: unknown = {}) => runTool(ctx, tool, input);
  return { m, ctx, ref, run, index };
}

/** Pickup order for Ali with 2 Zinger Burgers, ready for the summary. */
async function readyCart(s: Awaited<ReturnType<typeof setup>>, qty = 2) {
  await s.run("add_to_cart", { item_id: s.ref("Zinger Burger"), quantity: qty });
  await s.run("set_order_type", { order_type: "pickup" });
  await s.run("set_payment_method", { payment_method: "cod" });
}

describe("search_menu", () => {
  it("finds items despite misspellings, Roman Urdu and Urdu script", async () => {
    const { m } = await setup();
    const top = (q: string) => searchMenu(m.menu, q)[0]?.item.name;
    expect(top("zngr")).toBe("Zinger Burger");
    expect(top("2 zinger burger")).toBe("Zinger Burger");
    expect(top("biriyani")).toBe("Chicken Biryani");
    expect(top("بریانی")).toBe("Chicken Biryani");
    expect(top("chiken karai")).toBe("Chicken Karahi");
    expect(top("garlic nan")).toBe("Garlic Naan");
    expect(top("cold drink")).toBe("Coke 1.5L");
    expect(searchMenu(m.menu, "piza").map((h) => h.item.name)).toEqual(expect.arrayContaining(["Chicken Tikka Pizza", "Fajita Pizza"]));
  });

  it("returns nothing for items not on the menu", async () => {
    const { m, run } = await setup();
    expect(searchMenu(m.menu, "nihari")).toEqual([]);
    expect(searchMenu(m.menu, "sushi")).toEqual([]);
    expect(await run("search_menu", { query: "nihari" })).toMatchObject({ ok: false, error: "NOT_FOUND" });
  });

  it("returns ids, sizes with prices and required choices", async () => {
    const { run } = await setup();
    const r = (await run("search_menu", { query: "tikka pizza" })) as unknown as { ok: true; matches: Record<string, unknown>[] };
    expect(r.matches[0]).toMatchObject({
      item_id: expect.stringMatching(/^I\d+$/),
      name: "Chicken Tikka Pizza",
      sizes: [
        { name: "Small", price: "Rs 899" },
        { name: "Medium", price: "Rs 1,399" },
        { name: "Large", price: "Rs 1,850" },
      ],
      can_remove: ["Onion", "Olives", "Capsicum"],
    });
    const deal = (await run("search_menu", { query: "zinger deal" })) as unknown as { matches: { name: string; choices?: { required: boolean }[] }[] };
    expect(deal.matches.find((x) => x.name === "Zinger Deal")?.choices?.[0]).toMatchObject({ required: true });
  });

  it("marks sold-out items as unavailable", async () => {
    const { run } = await setup();
    const r = (await run("search_menu", { query: "loaded fries" })) as unknown as { matches: { name: string; available: boolean }[] };
    expect(r.matches[0]).toMatchObject({ name: "Loaded Fries", available: false });
  });
});

describe("add_to_cart", () => {
  it("adds a priced line from the pricing engine", async () => {
    const s = await setup();
    const r = await s.run("add_to_cart", { item_id: s.ref("Zinger Burger"), quantity: 2 });
    expect(r).toMatchObject({ ok: true, line: { line_id: "L1", quantity: 2, name: "Zinger Burger", line_total: "Rs 1,100" }, cart_subtotal: "Rs 1,100" });
    expect(s.ctx.session.cart[0]).toMatchObject({ unitPrice: 55000, lineTotal: 110000 });
  });

  it("merges the same item with the same choices into one line", async () => {
    const s = await setup();
    await s.run("add_to_cart", { item_id: s.ref("Zinger Burger"), quantity: 2 });
    const r = await s.run("add_to_cart", { item_id: s.ref("Zinger Burger"), quantity: 1 });
    expect(r).toMatchObject({ ok: true, merged_into_existing_line: true, line: { line_id: "L1", quantity: 3 } });
    expect(s.ctx.session.cart).toHaveLength(1);
    // Different choices → a separate line.
    await s.run("add_to_cart", { item_id: s.ref("Zinger Burger"), removals: ["mayo"] });
    expect(s.ctx.session.cart).toHaveLength(2);
  });

  it("accepts size, extras and removals by name (case-insensitive)", async () => {
    const s = await setup();
    const r = await s.run("add_to_cart", {
      item_id: s.ref("Chicken Tikka Pizza"),
      variant_id: "large",
      option_ids: ["extra cheese"],
      removals: ["onion"],
    });
    expect(r).toMatchObject({ ok: true, line: { size: "Large", extras: ["Extra Cheese"], without: ["Onion"], line_total: "Rs 2,000" } });
  });

  it("asks for a size: SIZE_REQUIRED with the valid sizes", async () => {
    const s = await setup();
    const r = await s.run("add_to_cart", { item_id: s.ref("Chicken Tikka Pizza") });
    expect(r).toMatchObject({ ok: false, error: "SIZE_REQUIRED", sizes: [{ name: "Small" }, { name: "Medium" }, { name: "Large" }] });
    expect(s.ctx.session.cart).toHaveLength(0);
  });

  it("asks for a required choice: REQUIRED_GROUP_MISSING with options", async () => {
    const s = await setup();
    const r = await s.run("add_to_cart", { item_id: s.ref("Zinger Deal") });
    expect(r).toMatchObject({ ok: false, error: "REQUIRED_GROUP_MISSING", choices: [{ group: "Choose your drink" }] });
    const ok = await s.run("add_to_cart", { item_id: s.ref("Zinger Deal"), option_ids: ["Sprite"] });
    expect(ok).toMatchObject({ ok: true, line: { extras: ["Sprite"], line_total: "Rs 799" } });
  });

  it("tells the AI which default choice was applied", async () => {
    const s = await setup();
    const r = await s.run("add_to_cart", { item_id: s.ref("Chicken Biryani") });
    expect(r).toMatchObject({ ok: true, default_choices_applied: ["Spice level: Medium"] });
  });

  it("rejects sold-out, unknown and invalid input", async () => {
    const s = await setup();
    expect(await s.run("add_to_cart", { item_id: s.ref("Loaded Fries") })).toMatchObject({ ok: false, error: "ITEM_OUT_OF_STOCK" });
    expect(await s.run("add_to_cart", { item_id: "I999" })).toMatchObject({ ok: false, error: "ITEM_NOT_FOUND" });
    expect(await s.run("add_to_cart", { item_id: s.ref("Zinger Burger"), quantity: 0 })).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(await s.run("add_to_cart", { item_id: s.ref("Zinger Burger"), removals: ["Cheese"] })).toMatchObject({
      ok: false,
      error: "INVALID_REMOVAL",
      can_remove: ["Mayo", "Lettuce"],
    });
    expect(await s.run("add_to_cart", { item_id: s.ref("Chicken Karahi"), variant_id: "XL" })).toMatchObject({ ok: false, error: "INVALID_SIZE" });
    expect(s.ctx.session.cart).toHaveLength(0);
  });

  it("refuses when the branch is closed", async () => {
    const s = await setup({ branch: { isOpenNow: false, todayHours: "12:00 PM – 11:00 PM" } });
    expect(await s.run("add_to_cart", { item_id: s.ref("Zinger Burger") })).toMatchObject({
      ok: false,
      error: "BRANCH_CLOSED",
      today_hours: "12:00 PM – 11:00 PM",
    });
  });
});

describe("update / remove / view cart", () => {
  it("changes quantity and size, and removes with quantity 0", async () => {
    const s = await setup();
    await s.run("add_to_cart", { item_id: s.ref("Chicken Tikka Pizza"), variant_id: "Medium" });
    expect(await s.run("update_cart_line", { line_id: "L1", variant_id: "Large", quantity: 2 })).toMatchObject({
      ok: true,
      line: { size: "Large", quantity: 2, line_total: "Rs 3,700" },
    });
    expect(await s.run("update_cart_line", { line_id: "L1", quantity: 0 })).toMatchObject({ ok: true, removed: "2× Chicken Tikka Pizza" });
    expect(s.ctx.session.cart).toHaveLength(0);
  });

  it("errors on unknown lines", async () => {
    const s = await setup();
    expect(await s.run("update_cart_line", { line_id: "L9", quantity: 2 })).toMatchObject({ ok: false, error: "LINE_NOT_FOUND" });
    expect(await s.run("remove_cart_line", { line_id: "L9" })).toMatchObject({ ok: false, error: "LINE_NOT_FOUND" });
  });

  it("view_cart shows lines, subtotal and what is still needed", async () => {
    const s = await setup({ customer: { name: null } });
    await s.run("add_to_cart", { item_id: s.ref("Zinger Burger"), quantity: 2 });
    await s.run("add_to_cart", { item_id: s.ref("Raita") });
    expect(await s.run("view_cart")).toMatchObject({
      ok: true,
      lines: [{ line_id: "L1" }, { line_id: "L2" }],
      subtotal: "Rs 1,180",
      still_needed: ["order_type", "payment_method", "customer_name"],
    });
  });
});

describe("checkout tools", () => {
  it("delivery address needs a landmark or a location pin", async () => {
    const s = await setup();
    expect(await s.run("set_delivery_address", { address_text: "Flat 3, Block B, Gulshan" })).toMatchObject({
      ok: false,
      error: "LANDMARK_REQUIRED",
    });
    expect(s.ctx.session.orderType).toBe("delivery");
    // Part of the address is not a landmark.
    expect(await s.run("set_delivery_address", { address_text: "Flat 3, Block B, Gulshan", landmark: "Block B" })).toMatchObject({
      ok: false,
      error: "LANDMARK_REQUIRED",
    });
    expect(await s.run("set_delivery_address", { address_text: "Flat 3, Block B", area: "Gulshan", landmark: "Gulshan" })).toMatchObject({
      ok: false,
      error: "LANDMARK_REQUIRED",
    });
    expect(await s.run("set_delivery_address", { address_text: "Flat 3, Block B, Gulshan", landmark: "near Imtiaz" })).toMatchObject({ ok: true });
    const pin = await setup();
    expect(await pin.run("set_delivery_address", { address_text: "House 9", latitude: 24.8, longitude: 67.0 })).toMatchObject({ ok: true });
  });

  it("validates payment method and name", async () => {
    const s = await setup({ customer: { name: null } });
    expect(await s.run("set_payment_method", { payment_method: "jazzcash" })).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(await s.run("set_customer_name", { name: "A" })).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(await s.run("set_customer_name", { name: "Hamza" })).toMatchObject({ ok: true, name: "Hamza" });
    expect(s.m.customers.get(s.ctx.customer!.id)?.name).toBe("Hamza");
  });

  it("restaurant info and order status come from the data", async () => {
    const s = await setup();
    expect(await s.run("get_restaurant_info")).toMatchObject({ ok: true, name: "Cheezious", open_now: true, delivery_fee: "Rs 150", minimum_order_for_delivery: "Rs 500" });
    expect(await s.run("check_order_status")).toMatchObject({ ok: true, orders: [] });
  });

  it("handoff and three not-understood attempts hand the chat to staff", async () => {
    const s = await setup();
    await s.run("mark_not_understood");
    await s.run("mark_not_understood");
    expect(s.ctx.session.status).toBe("active");
    await s.run("mark_not_understood");
    expect(s.ctx.session.status).toBe("handed_off");
    const h = await setup();
    await h.run("handoff_to_staff", { reason: "customer asked for a manager" });
    expect(h.ctx.session).toMatchObject({ status: "handed_off", handoffReason: "customer asked for a manager" });
  });
});

describe("show_order_summary", () => {
  it("lists what's missing", async () => {
    const s = await setup({ customer: { name: null } });
    expect(await s.run("show_order_summary")).toMatchObject({ ok: false, error: "NOT_READY", missing: ["cart_empty", "order_type", "payment_method", "customer_name"] });
  });

  it("enforces the delivery minimum order", async () => {
    const s = await setup();
    await s.run("add_to_cart", { item_id: s.ref("Raita") });
    await s.run("set_delivery_address", { address_text: "House 5", landmark: "near Teen Talwar" });
    await s.run("set_payment_method", { payment_method: "cod" });
    expect(await s.run("show_order_summary")).toMatchObject({ ok: false, missing: ["minimum_order"], minimum_order: "Rs 500", current_subtotal: "Rs 80" });
  });

  it("builds the summary in code, saves the hash and waits for confirmation", async () => {
    const s = await setup();
    await s.run("add_to_cart", { item_id: s.ref("Chicken Tikka Pizza"), variant_id: "Large", option_ids: ["Extra Cheese"], removals: ["Onion"] });
    await s.run("set_delivery_address", { address_text: "House 7, Street 2", area: "Clifton", landmark: "near Dolmen Mall" });
    await s.run("set_payment_method", { payment_method: "cod" });
    const r = await s.run("show_order_summary");
    expect(r).toMatchObject({ ok: true, ready: true, summary: { subtotal: "Rs 2,000", delivery_fee: "Rs 150", total: "Rs 2,150" }, show_buttons: ["confirm", "change", "cancel"] });
    const text = s.ctx.effects.summary!.text;
    expect(text).toContain("1× Chicken Tikka Pizza (Large, + Extra Cheese, Onion nahi) — Rs 2,000");
    expect(text).toContain("Delivery charges: Rs 150");
    expect(text).toContain("*Total*: *Rs 2,150*");
    expect(text).toContain("near Dolmen Mall");
    expect(s.ctx.session).toMatchObject({ status: "awaiting_confirmation", stage: "awaiting_confirmation", summaryHash: expect.any(String) });
  });

  it("writes the summary in Urdu script with Urdu item names", async () => {
    const s = await setup();
    s.ctx.session.language = "urdu";
    await readyCart(s);
    await s.run("show_order_summary");
    expect(s.ctx.effects.summary!.text).toContain("زنگر برگر");
    expect(s.ctx.effects.summary!.text).toContain("کل رقم");
  });

  it("refuses while the branch is closed", async () => {
    const s = await setup();
    await readyCart(s);
    s.ctx.branch = { ...s.ctx.branch, isOpenNow: false };
    expect(await s.run("show_order_summary")).toMatchObject({ ok: false, error: "BRANCH_CLOSED" });
  });
});

describe("confirm_order", () => {
  it("only works after a summary (wrong stage)", async () => {
    const s = await setup();
    await readyCart(s);
    expect(await s.run("confirm_order")).toMatchObject({ ok: false, error: "NOT_AWAITING_CONFIRMATION" });
    expect(s.m.orders).toHaveLength(0);
  });

  it("any change after the summary needs a new summary", async () => {
    const s = await setup();
    await readyCart(s);
    await s.run("show_order_summary");
    await s.run("update_cart_line", { line_id: "L1", quantity: 3 });
    expect(s.ctx.session.status).toBe("active");
    expect(await s.run("confirm_order")).toMatchObject({ ok: false, error: "NOT_AWAITING_CONFIRMATION" });
  });

  it("refuses if the cart no longer matches the summary hash", async () => {
    const s = await setup();
    await readyCart(s);
    await s.run("show_order_summary");
    s.ctx.session.cart[0].quantity = 5; // changed behind the summary's back
    expect(await s.run("confirm_order")).toMatchObject({ ok: false, error: "CART_CHANGED" });
    expect(s.m.orders).toHaveLength(0);
    expect(s.ctx.session.summaryHash).toBeNull();
  });

  it("creates exactly one order with the engine's totals (idempotent)", async () => {
    const s = await setup({ customer: { totalOrders: 3 } });
    await readyCart(s);
    await s.run("show_order_summary");
    const r = await s.run("confirm_order");
    expect(r).toMatchObject({ ok: true, order_number: 1001 });
    expect(s.m.orders).toHaveLength(1);
    expect(s.m.orders[0]).toMatchObject({ total: 110000, status: "awaiting_acceptance", riskFlag: null });
    expect(s.ctx.session).toMatchObject({ status: "completed", stage: "done", orderId: s.m.orders[0].id });
    // A second confirm (double tap) never creates another order.
    expect(await s.run("confirm_order")).toMatchObject({ ok: true, already_placed: true });
    // Same idempotency key at the engine → the same order.
    const again = await s.m.store.createOrder({
      session: s.ctx.session,
      customer: s.ctx.customer!,
      deliveryFee: 0,
      idempotencyKey: s.m.orders[0].idempotencyKey,
    });
    expect(again).toMatchObject({ ok: true, data: { duplicate: true, orderNumber: 1001 } });
    expect(s.m.orders).toHaveLength(1);
  });

  it("flags new customers with a high-value cash order", async () => {
    const s = await setup();
    await s.run("add_to_cart", { item_id: s.ref("Chicken Tikka Pizza"), variant_id: "Large", quantity: 3 });
    await s.run("set_delivery_address", { address_text: "House 1", landmark: "near Bukhari Commercial" });
    await s.run("set_payment_method", { payment_method: "cod" });
    await s.run("show_order_summary");
    await s.run("confirm_order");
    expect(s.m.orders[0]).toMatchObject({ total: 570000, riskFlag: "New customer, high value — call to confirm." });

    const card = await setup();
    await card.run("add_to_cart", { item_id: card.ref("Chicken Tikka Pizza"), variant_id: "Large", quantity: 3 });
    await card.run("set_order_type", { order_type: "pickup" });
    await card.run("set_payment_method", { payment_method: "card_on_delivery" });
    await card.run("show_order_summary");
    await card.run("confirm_order");
    expect(card.m.orders[0].riskFlag).toBeNull();
  });

  it("cancel_session clears the order before it is placed", async () => {
    const s = await setup();
    await readyCart(s);
    await s.run("cancel_session");
    expect(s.ctx.session).toMatchObject({ status: "abandoned", stage: "done", cart: [] });
  });
});

describe("stage and summary hash", () => {
  it("stage follows the first missing piece", async () => {
    const s = await setup({ customer: { name: null } });
    expect(computeStage(s.ctx.session, s.ctx.customer)).toBe("collecting_items");
    await s.run("add_to_cart", { item_id: s.ref("Raita") });
    expect(computeStage(s.ctx.session, s.ctx.customer)).toBe("choosing_order_type");
    await s.run("set_order_type", { order_type: "delivery" });
    expect(computeStage(s.ctx.session, s.ctx.customer)).toBe("collecting_address");
    await s.run("set_delivery_address", { address_text: "House 1", landmark: "near park" });
    expect(computeStage(s.ctx.session, s.ctx.customer)).toBe("choosing_payment");
    await s.run("set_payment_method", { payment_method: "cod" });
    expect(computeStage(s.ctx.session, s.ctx.customer)).toBe("collecting_name");
  });

  it("hash changes with anything the customer agrees to", async () => {
    const s = await setup();
    await readyCart(s);
    const a = summaryHash(s.ctx.session, 0, "Ali");
    expect(summaryHash(s.ctx.session, 0, "Ali")).toBe(a);
    expect(summaryHash(s.ctx.session, 0, "Bilal")).not.toBe(a);
    expect(summaryHash(s.ctx.session, 15000, "Ali")).not.toBe(a);
    s.ctx.session.paymentMethod = "card_on_delivery";
    expect(summaryHash(s.ctx.session, 0, "Ali")).not.toBe(a);
  });
});

describe("detectLanguage", () => {
  it("detects Urdu script, Roman Urdu and English", () => {
    expect(detectLanguage("مجھے دو زنگر برگر چاہیے")).toBe("urdu");
    expect(detectLanguage("2 zinger aur ek coke chahiye")).toBe("roman_urdu");
    expect(detectLanguage("mera order kahan hai?")).toBe("roman_urdu");
    expect(detectLanguage("I'd like 2 zinger burgers please")).toBe("english");
    expect(detectLanguage("Where is my order?")).toBe("english");
  });

  it("keeps the current language for short or neutral messages", () => {
    expect(detectLanguage("pickup")).toBeNull();
    expect(detectLanguage("2 zinger")).toBeNull();
    expect(detectLanguage("👍")).toBeNull();
    expect(detectLanguage("large")).toBeNull();
  });
});
