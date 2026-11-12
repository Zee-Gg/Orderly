import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { runBotTurn, startSession } from "./agent";
import { buildMenuIndex } from "./menu-index";
import { BRANCH_ID, createMemoryBotStore, RESTAURANT_ID } from "./testing/memory-store";

/** A model that replies with scripted steps: tool calls, then text. */
type Step = { tools?: { name: string; input: unknown }[]; text?: string };
function scripted(steps: Step[]) {
  let i = 0;
  const usage = {
    inputTokens: { total: 1000, noCache: 800, cacheRead: 200, cacheWrite: 0 },
    outputTokens: { total: 50, text: 50, reasoning: 0 },
  };
  return new MockLanguageModelV4({
    modelId: "mock-model",
    doGenerate: async () => {
      const step = steps[Math.min(i++, steps.length - 1)];
      const content = [
        ...(step.tools ?? []).map((t, n) => ({ type: "tool-call" as const, toolCallId: `c${i}-${n}`, toolName: t.name, input: JSON.stringify(t.input) })),
        ...(step.text !== undefined ? [{ type: "text" as const, text: step.text }] : []),
      ];
      return {
        content,
        finishReason: { unified: step.tools?.length ? ("tool-calls" as const) : ("stop" as const), raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

async function setup(
  customer: Parameters<ReturnType<typeof createMemoryBotStore>["addCustomer"]>[0] = { name: "Ali" },
  store: Parameters<typeof createMemoryBotStore>[0] = {},
) {
  const m = createMemoryBotStore(store);
  const c = m.addCustomer(customer);
  const idx = buildMenuIndex(m.menu);
  const ref = (name: string) => idx.itemRef.get(m.itemIds[name])!;
  const turn = (messages: string[], model: MockLanguageModelV4 | null, extra: { sessionId?: string | null; buttonId?: string } = {}) =>
    runBotTurn(
      {
        restaurantId: RESTAURANT_ID,
        branchId: BRANCH_ID,
        sessionId: extra.sessionId ?? null,
        customerId: c.id,
        customerMessages: messages,
        buttonId: extra.buttonId,
      },
      { store: m.store, provider: "google", model: model ? { model, modelId: "mock-model" } : undefined, sleep: async () => {} },
    );
  return { m, c, ref, turn };
}

/** The reply before the menu-link line a new chat gets. */
const firstPart = (text: string | null) => text?.split("\n\n")[0];

describe("runBotTurn", () => {
  it("runs tools, replies with the model's text and logs the turn", async () => {
    const { m, ref, turn } = await setup();
    const model = scripted([{ tools: [{ name: "add_to_cart", input: { item_id: ref("Zinger Burger"), quantity: 2 } }] }, { text: "2 Zinger add kar diye! Delivery ya pickup?" }]);
    const r = await turn(["2 zinger chahiye"], model);
    expect(r.replyText).toBe("2 Zinger add kar diye! Delivery ya pickup?");
    expect(r.session.cart).toMatchObject([{ name: "Zinger Burger", quantity: 2, lineTotal: 110000 }]);
    expect(r.session.stage).toBe("choosing_order_type");
    expect(r.showButtons?.map((b) => b.id)).toEqual(["order_type_delivery", "order_type_pickup"]);
    expect(r.toolCalls.map((t) => t.tool)).toEqual(["add_to_cart"]);
    expect(m.logs).toHaveLength(1);
    expect(m.logs[0]).toMatchObject({ inputText: "2 zinger chahiye", model: "mock-model", inputTokens: 2000, cacheReadTokens: 400, errorType: null });
    // Saved for the next turn, with the transcript.
    const saved = await m.store.getSession(RESTAURANT_ID, r.sessionId);
    expect(saved?.transcript.map((e) => e.role)).toEqual(["customer", "bot"]);
  });

  it("never shows internal refs (I3, S2, L1) to the customer", async () => {
    const { ref, turn } = await setup();
    const raita = ref("Raita");
    const r = await turn(["ek biryani"], scripted([{ text: `Biryani add! Saath mein Raita (${raita}) lenge? Ya ${raita} nahi?` }]));
    expect(firstPart(r.replyText)).toBe("Biryani add! Saath mein Raita lenge? Ya Raita nahi?");
  });

  it("sends the summary written by code, never the model's version", async () => {
    const { ref, turn } = await setup();
    const model = scripted([
      {
        tools: [
          { name: "add_to_cart", input: { item_id: ref("Zinger Burger"), quantity: 2 } },
          { name: "set_order_type", input: { order_type: "pickup" } },
          { name: "set_payment_method", input: { payment_method: "cod" } },
        ],
      },
      { tools: [{ name: "show_order_summary", input: {} }] },
      { text: "Total Rs 50 only!" }, // a wrong price the customer must never see
    ]);
    const r = await turn(["2 zinger, pickup, cash"], model);
    expect(r.replyText).toContain("2× Zinger Burger — Rs 1,100");
    expect(r.replyText).not.toContain("Rs 50 only");
    expect(r.showButtons?.map((b) => b.id)).toEqual(["confirm", "change", "cancel"]);
    expect(r.session.stage).toBe("awaiting_confirmation");
  });

  it("the Confirm button places the order without calling the AI", async () => {
    const { m, ref, turn } = await setup();
    const first = await turn(
      ["2 zinger, pickup, cash"],
      scripted([
        {
          tools: [
            { name: "add_to_cart", input: { item_id: ref("Zinger Burger"), quantity: 2 } },
            { name: "set_order_type", input: { order_type: "pickup" } },
            { name: "set_payment_method", input: { payment_method: "cod" } },
            { name: "show_order_summary", input: {} },
          ],
        },
        { text: "" },
      ]),
    );
    const noAi = scripted([{ text: "should not be called" }]);
    const r = await turn(["Confirm ✅"], noAi, { sessionId: first.sessionId, buttonId: "confirm" });
    expect(noAi.doGenerateCalls).toHaveLength(0);
    expect(r.orderCreated).toMatchObject({ orderNumber: 1001 });
    expect(r.replyText).toContain("#1001");
    expect(m.orders).toHaveLength(1);
    expect(r.session).toMatchObject({ status: "completed", stage: "done" });
    // A second tap (double tap / slow network): no new order, no AI, no new session.
    const again = await turn(["Confirm ✅"], noAi, { sessionId: first.sessionId, buttonId: "confirm" });
    expect(again.replyText).toContain("pehle hi");
    expect(again.sessionId).toBe(first.sessionId);
    expect(noAi.doGenerateCalls).toHaveLength(0);
    expect(m.orders).toHaveLength(1);
  });

  it("blocked customers get the restaurant phone and no AI call", async () => {
    const { m, turn } = await setup({ name: "X", isBlocked: true });
    const model = scripted([{ text: "hi" }]);
    const r = await turn(["2 zinger"], model);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(r.replyText).toContain(m.restaurant.phone!);
    expect(r.session.cart).toEqual([]);
  });

  it("an empty menu never reaches the AI (no invented items)", async () => {
    const { turn } = await setup({ name: "Ali" }, { emptyMenu: true });
    const model = scripted([{ text: "We only have drinks!" }]);
    const r = await turn(["1 pizza aur 2 burger"], model);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(r.replyText).toContain("online menu available nahi");
    expect(r.handedOff).toBe(true);
  });

  it("a handed-off chat stays with staff (no bot reply)", async () => {
    const { turn } = await setup();
    const first = await turn(["agent"], scripted([{ tools: [{ name: "handoff_to_staff", input: { reason: "asked for a human" } }] }, { text: "Staff jald baat karega." }]));
    expect(first.handedOff).toBe(true);
    const model = scripted([{ text: "hi" }]);
    const r = await turn(["hello?"], model, { sessionId: first.sessionId });
    expect(r.replyText).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("retries once on a rate limit, then gives a friendly fallback and hands off", async () => {
    const { m, turn } = await setup();
    const err = () => new APICallError({ message: "Resource exhausted", url: "x", requestBodyValues: {}, statusCode: 429 });
    const model = new MockLanguageModelV4({
      modelId: "mock-model",
      doGenerate: async () => {
        throw err();
      },
    });
    const r = await turn(["2 zinger"], model);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(r.replyText).toContain("Maazrat");
    expect(r.handedOff).toBe(true);
    expect(r.error?.type).toBe("rate_limit");
    expect(m.logs[0]).toMatchObject({ errorType: "rate_limit" });
  });

  it("recovers when the retry succeeds", async () => {
    const { turn } = await setup();
    let calls = 0;
    const model = new MockLanguageModelV4({
      modelId: "mock-model",
      doGenerate: async () => {
        if (calls++ === 0) throw new APICallError({ message: "too many requests", url: "x", requestBodyValues: {}, statusCode: 429 });
        return {
          content: [{ type: "text", text: "Ji, bataiye kya chahiye?" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
          warnings: [],
        };
      },
    });
    const r = await turn(["salam"], model);
    expect(firstPart(r.replyText)).toBe("Ji, bataiye kya chahiye?");
    // New chat, nothing ordered yet: one line with the menu page link.
    expect(r.replyText).toMatch(/\n\n📋 Menu dekh kar order karein 👉 https?:\/\/\S+\/m\/cheezious$/);
    expect(r.error).toBeNull();
    expect(r.handedOff).toBe(false);
  });

  it("an idle session (2h+) is abandoned and a new one starts", async () => {
    const { m, c, ref, turn } = await setup();
    const old = await startSession(m.store, { restaurantId: RESTAURANT_ID, branchId: BRANCH_ID, customerId: c.id });
    old.cart = [];
    old.lastActivityAt = new Date(Date.now() - 3 * 3600_000).toISOString();
    await m.store.saveSession(old);
    const r = await turn(["2 zinger"], scripted([{ tools: [{ name: "add_to_cart", input: { item_id: ref("Zinger Burger"), quantity: 2 } }] }, { text: "ok" }]), {
      sessionId: old.id,
    });
    expect(r.sessionId).not.toBe(old.id);
    expect((await m.store.getSession(RESTAURANT_ID, old.id))?.status).toBe("abandoned");
  });

  it("remembers the customer's language", async () => {
    const { m, c, turn } = await setup();
    await turn(["مجھے دو زنگر برگر چاہیے"], scripted([{ text: "جی" }]));
    expect(m.customers.get(c.id)?.preferredLanguage).toBe("urdu");
  });

  it("tool errors never crash the turn", async () => {
    const { m, ref, turn } = await setup();
    vi.spyOn(m.store, "priceLine").mockRejectedValueOnce(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await turn(["zinger"], scripted([{ tools: [{ name: "add_to_cart", input: { item_id: ref("Zinger Burger") } }] }, { text: "Maazrat, masla aa gaya." }]));
    expect(r.toolCalls[0].output).toMatchObject({ ok: false, error: "INTERNAL_ERROR" });
    expect(firstPart(r.replyText)).toBe("Maazrat, masla aa gaya.");
    error.mockRestore();
  });

  it("a new chat mentions ONE current offer (first message only); the owner can switch it off", async () => {
    const store: NonNullable<Parameters<typeof createMemoryBotStore>[0]> = {};
    const { m, turn } = await setup({ name: "Ali" }, store);
    const offer = (title: string, item: string, i: number) => ({
      id: `o${i}`,
      branchId: null,
      title,
      titleUr: null,
      description: null,
      menuItemId: m.itemIds[item],
      imagePath: null,
      startsAt: "2026-01-01T00:00:00Z",
      endsAt: null,
      daysOfWeek: null,
      startTime: null,
      endTime: null,
      isActive: true,
      sortOrder: i,
    });
    store.offers = [offer("Student Deal", "Student Deal", 0), offer("Friday Deal", "Friday Deal: 2 Zinger + 1.5L Coke", 1)];
    const prompt = (model: MockLanguageModelV4) => JSON.stringify(model.doGenerateCalls[0].prompt);

    const first = scripted([{ text: "Assalam o alaikum! Aaj Student Deal chal rahi hai." }]);
    const r = await turn(["salam"], first);
    expect(prompt(first)).toContain("NEW CHAT — TODAY'S OFFER");
    expect(prompt(first)).toContain("Student Deal");
    expect(prompt(first)).not.toContain('"Friday Deal');

    const second = scripted([{ text: "Ji?" }]);
    await turn(["menu?"], second, { sessionId: r.sessionId });
    expect(prompt(second)).not.toContain("TODAY'S OFFER");

    // Switched off in /settings/bot → no offer, even in a new chat.
    const fresh = await setup({ name: "Sara" }, { ...store, restaurant: { mentionOfferOnGreeting: false } });
    store.offers = store.offers.map((o) => ({ ...o, menuItemId: fresh.m.itemIds[o.title === "Student Deal" ? "Student Deal" : "Friday Deal: 2 Zinger + 1.5L Coke"] }));
    const none = scripted([{ text: "Ji" }]);
    await fresh.turn(["salam"], none);
    expect(prompt(none)).not.toContain("TODAY'S OFFER");
  });
});

describe("menu-page order codes (Phase 8)", () => {
  const promptOf = (model: MockLanguageModelV4) => JSON.stringify(model.doGenerateCalls[0]?.prompt ?? "");
  const pizzaLarge = (m: ReturnType<typeof createMemoryBotStore>) => {
    const pizza = m.menu.categories.flatMap((c) => c.items).find((i) => i.name === "Chicken Tikka Pizza")!;
    return { variantId: pizza.sizes.find((s) => s.name === "Large")!.id, cheese: pizza.groups[0].options.find((o) => o.name === "Extra Cheese")!.id };
  };

  it("a valid code loads the cart with engine prices, sets the order type, and the AI continues", async () => {
    const { m, turn } = await setup();
    const p = pizzaLarge(m);
    m.addDraft({
      code: "7K3P",
      orderType: "delivery",
      lines: [
        { item: "Zinger Burger", quantity: 2 },
        { item: "Chicken Tikka Pizza", variantId: p.variantId, optionIds: [p.cheese], removals: ["Olives"], quantity: 1 },
      ],
    });
    const model = scripted([{ text: "Delivery address bata dein?" }]);
    const r = await turn(["Hi! Mera order code: 7k3p 🛒\n2x Zinger Burger\n1x Large Chicken Tikka Pizza\n(Delivery)"], model);
    expect(r.session.cart.map((l) => [l.name, l.quantity, l.lineTotal])).toEqual([
      ["Zinger Burger", 2, 110000],
      ["Chicken Tikka Pizza", 1, 200000],
    ]);
    expect(r.session.cart[1].removals).toEqual(["Olives"]);
    expect(r.session.orderType).toBe("delivery");
    expect(r.session.cartDraftId).toBe("draft-1");
    expect(m.drafts.get("7K3P")!.usedAt).not.toBeNull();
    expect(r.replyText).toBe("🛒 Aap ka order mil gaya: 2x Zinger Burger, 1x Chicken Tikka Pizza (Large).\n\nDelivery address bata dein?");
    // The AI got a note, not the list (so it can't add the items twice).
    expect(promptOf(model)).toContain("ALREADY loaded their cart");
    expect(promptOf(model)).not.toContain("2x Zinger Burger\n1x Large");
    expect(r.toolCalls).toEqual([]);
  });

  it("a code works only once", async () => {
    const { m, turn } = await setup();
    m.addDraft({ code: "H8M2", lines: [{ item: "Raita", quantity: 1 }] });
    const first = await turn(["code H8M2"], scripted([{ text: "Delivery ya pickup?" }]));
    const again = scripted([{ text: "x" }]);
    const r = await turn(["code H8M2"], again, { sessionId: first.sessionId });
    expect(r.replyText).toMatch(/^Ye order code expire ho gaya hai\. Menu se dobara bhejein ya yahan type kar dein 🙏\n👉 \S+\/m\/cheezious$/);
    expect(again.doGenerateCalls).toHaveLength(0);
  });

  it("expired or unknown codes → 'expired' with the menu link, no AI", async () => {
    const { m, turn } = await setup();
    m.addDraft({ code: "Q4RT", lines: [{ item: "Raita", quantity: 1 }], expiresAt: new Date(Date.now() - 60_000).toISOString() });
    const model = scripted([{ text: "x" }]);
    expect((await turn(["Hi! Mera order code: Q4RT"], model)).replyText).toMatch(/^Ye order code expire ho gaya hai/);
    expect((await turn(["mera order code ZZ9Z hai"], model)).replyText).toMatch(/^Ye order code expire ho gaya hai/);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(m.drafts.get("Q4RT")!.usedAt).toBeNull();
  });

  it("a code-looking word without the word 'code' is just a normal message", async () => {
    const { turn } = await setup();
    const model = scripted([{ text: "Ji, kitne naan?" }]);
    const r = await turn(["4PCS naan chahiye"], model);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(firstPart(r.replyText)).toBe("Ji, kitne naan?");
  });

  it("an item that went out of stock since the draft is skipped and named", async () => {
    const { m, turn } = await setup();
    m.addDraft({ code: "W7XK", lines: [{ item: "Zinger Burger", quantity: 1 }, { item: "Loaded Fries", quantity: 1 }] });
    const r = await turn(["Hi! Mera order code: W7XK"], scripted([{ text: "Delivery ya pickup?" }]));
    expect(r.session.cart.map((l) => l.name)).toEqual(["Zinger Burger"]);
    expect(r.replyText).toContain("🛒 Aap ka order mil gaya: 1x Zinger Burger.\n1x Loaded Fries abhi available nahi.");
  });

  it("nothing available → says so, no AI", async () => {
    const { m, turn } = await setup();
    m.addDraft({ code: "F3NN", lines: [{ item: "Loaded Fries", quantity: 2 }] });
    const model = scripted([{ text: "x" }]);
    const r = await turn(["code F3NN"], model);
    expect(r.replyText).toBe("Maazrat, 2x Loaded Fries abhi available nahi. Kuch aur order karna chahenge?");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("a cart already in the chat → Replace / Add buttons; Add merges, Replace swaps", async () => {
    const { m, ref, turn } = await setup();
    const start = await turn(["2 zinger"], scripted([{ tools: [{ name: "add_to_cart", input: { item_id: ref("Zinger Burger"), quantity: 2 } }] }, { text: "Aur kuch?" }]));
    m.addDraft({ code: "A2B3", lines: [{ item: "Zinger Burger", quantity: 1 }, { item: "Raita", quantity: 1 }] });
    m.addDraft({ code: "C4D5", lines: [{ item: "Raita", quantity: 3 }] });

    const ask = await turn(["Hi! Mera order code: A2B3"], scripted([{ text: "x" }]), { sessionId: start.sessionId });
    expect(ask.replyText).toBe("Aap ke cart mein pehle se items hain. Naya order un ki jagah rakhein ya saath add karein?");
    expect(ask.showButtons?.map((b) => b.id)).toEqual(["cart_replace", "cart_add"]);
    expect(m.drafts.get("A2B3")!.usedAt).toBeNull(); // not used until they choose

    const added = await turn(["➕ Add"], scripted([{ text: "Delivery ya pickup?" }]), { sessionId: start.sessionId, buttonId: "cart_add" });
    expect(added.session.cart.map((l) => [l.name, l.quantity])).toEqual([
      ["Zinger Burger", 3],
      ["Raita", 1],
    ]);

    await turn(["Hi! Mera order code: C4D5"], scripted([{ text: "x" }]), { sessionId: start.sessionId });
    const replaced = await turn(["🔄 Replace"], scripted([{ text: "Delivery ya pickup?" }]), { sessionId: start.sessionId, buttonId: "cart_replace" });
    expect(replaced.session.cart.map((l) => [l.name, l.quantity])).toEqual([["Raita", 3]]);
    expect(replaced.replyText).toMatch(/^🛒 Aap ka order mil gaya: 3x Raita\./);
  });
});
