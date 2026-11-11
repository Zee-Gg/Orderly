import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { buildMenuIndex } from "../menu-index";
import { BRANCH_ID, createMemoryBotStore, RESTAURANT_ID } from "../testing/memory-store";
import type { BotButton } from "../agent";
import type { BotChannelStore, ChannelConversation, PendingMessage } from "./channel";
import { combineMessages, createBotPipeline } from "./pipeline";

type Step = { tools?: { name: string; input: unknown }[]; text?: string };

/** Each bot turn plays the next script; within a turn, steps run in order. */
function scriptedTurns(turns: Step[][]) {
  let turn = -1;
  let step = 0;
  let users = 0;
  return new MockLanguageModelV4({
    modelId: "mock",
    doGenerate: async (options) => {
      // A new customer message (more user messages than before) = a new turn.
      const prompt = options.prompt as unknown as { role: string }[];
      const userCount = prompt.filter((m) => m.role === "user").length;
      if (userCount > users) {
        users = userCount;
        turn++;
        step = 0;
      }
      const s = turns[Math.min(turn, turns.length - 1)][Math.min(step++, turns[Math.min(turn, turns.length - 1)].length - 1)];
      return {
        content: [
          ...(s.tools ?? []).map((x, i) => ({ type: "tool-call" as const, toolCallId: `t${turn}-${step}-${i}`, toolName: x.name, input: JSON.stringify(x.input) })),
          ...(s.text !== undefined ? [{ type: "text" as const, text: s.text }] : []),
        ],
        finishReason: { unified: s.tools?.length ? ("tool-calls" as const) : ("stop" as const), raw: undefined },
        usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
        warnings: [],
      };
    },
  });
}

function setup(opts: { budget?: { budget: number | null; spent: number } } = {}) {
  const m = createMemoryBotStore();
  const customer = m.addCustomer({ name: "Ali", phone: "+923001234567" });
  const conversation: ChannelConversation & { lockUntil: number } = {
    id: "conv-1",
    restaurantId: RESTAURANT_ID,
    waId: "923001234567",
    customerId: customer.id,
    botEnabled: true,
    botMutedUntil: null,
    lockUntil: 0,
  };
  const messages: (PendingMessage & { handled: boolean })[] = [];
  const handoffs: string[] = [];
  let seq = 0;
  let clock = Date.parse("2026-11-10T12:00:00Z");

  const channel: BotChannelStore = {
    getConversation: async () => ({ ...conversation }),
    newestInboundId: async () => messages.at(-1)?.id ?? null,
    pendingInbound: async () => messages.filter((x) => !x.handled).map((x) => ({ id: x.id, type: x.type, body: x.body, raw: x.raw, createdAt: x.createdAt })),
    isHandled: async (id) => messages.find((x) => x.id === id)?.handled ?? true,
    markHandled: async (ids) => messages.forEach((x) => ids.includes(x.id) && (x.handled = true)),
    countInboundSince: async (_c, since) => messages.filter((x) => x.createdAt >= since).length,
    claimLock: async () => {
      if (conversation.lockUntil > clock) return false;
      conversation.lockUntil = clock + 60_000;
      return true;
    },
    releaseLock: async () => {
      conversation.lockUntil = 0;
    },
    setMuted: async (_c, until) => {
      conversation.botMutedUntil = until;
    },
    setHandoff: async (_r, _c, reason) => {
      conversation.botEnabled = false;
      handoffs.push(reason);
    },
    findOpenSessionId: async () => [...m.sessions.values()].find((s) => ["active", "awaiting_confirmation", "handed_off"].includes(s.status))?.id ?? null,
    defaultBranchId: async () => BRANCH_ID,
    aiBudget: async () => opts.budget ?? { budget: null, spent: 0 },
  };

  const sent: { text: string; buttons: string[] | null }[] = [];
  const sender = {
    sendText: vi.fn(async (_r: string, _to: string, text: string) => {
      sent.push({ text, buttons: null });
      return { ok: true };
    }),
    sendInteractiveButtons: vi.fn(async (_r: string, _to: string, text: string, buttons: BotButton[]) => {
      sent.push({ text, buttons: buttons.map((b) => b.id) });
      return { ok: true };
    }),
  };

  const inbound = (body: string | null, type = "text", raw: Record<string, unknown> = {}) => {
    const id = `msg-${++seq}`;
    messages.push({ id, type, body, raw: raw as never, createdAt: new Date(clock).toISOString(), handled: false });
    return id;
  };
  const idx = buildMenuIndex(m.menu);
  const ref = (name: string) => idx.itemRef.get(m.itemIds[name])!;

  const make = (model: MockLanguageModelV4) =>
    createBotPipeline({
      channel,
      botStore: m.store,
      sender,
      agent: { provider: "google", model: { model, modelId: "mock" }, sleep: async () => {} },
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => new Date(clock),
    });
  const trigger = (messageId: string) => ({ restaurantId: RESTAURANT_ID, branchId: BRANCH_ID, conversationId: "conv-1", messageId });
  return { m, conversation, messages, handoffs, sent, sender, inbound, ref, make, trigger };
}

describe("combineMessages", () => {
  it("joins texts, reads button ids and location pins, spots media-only batches", () => {
    const base = { createdAt: "", raw: {} };
    expect(
      combineMessages([
        { ...base, id: "1", type: "text", body: "2 zinger" },
        { ...base, id: "2", type: "text", body: "aur ek coke" },
      ]),
    ).toEqual({ texts: ["2 zinger", "aur ek coke"], buttonId: null, location: null, mediaOnly: false });
    expect(
      combineMessages([{ ...base, id: "1", type: "interactive", body: "🛵 Delivery", raw: { interactive: { button_reply: { id: "order_type_delivery", title: "🛵 Delivery" } } } }]),
    ).toMatchObject({ texts: ["🛵 Delivery"], buttonId: "order_type_delivery" });
    expect(
      combineMessages([{ ...base, id: "1", type: "location", body: "Home", raw: { location: { latitude: 24.8, longitude: 67.0, name: "Home" } } }]),
    ).toMatchObject({ location: { latitude: 24.8, longitude: 67.0, name: "Home" } });
    expect(combineMessages([{ ...base, id: "1", type: "audio", body: null }])).toMatchObject({ mediaOnly: true });
    // A photo with a caption: the caption is read.
    expect(combineMessages([{ ...base, id: "1", type: "image", body: "yeh wala" }])).toMatchObject({ texts: ["yeh wala"], mediaOnly: false });
  });
});

describe("bot pipeline", () => {
  it("batches rapid messages into ONE bot turn (the newest message handles them)", async () => {
    const s = setup();
    const model = scriptedTurns([[{ tools: [{ name: "add_to_cart", input: { item_id: s.ref("Zinger Burger"), quantity: 2 } }] }, { text: "2 Zinger add! Delivery ya pickup?" }]]);
    const p = s.make(model);
    const first = s.inbound("2 zinger");
    const second = s.inbound("aur jaldi");
    await p.handleInbound(s.trigger(first)); // older: leaves it to the newest
    expect(s.sent).toHaveLength(0);
    await p.handleInbound(s.trigger(second));
    expect(s.m.logs).toHaveLength(1);
    expect(s.m.logs[0].inputText).toBe("2 zinger\naur jaldi");
    expect(s.sent).toEqual([{ text: "2 Zinger add! Delivery ya pickup?", buttons: ["order_type_delivery", "order_type_pickup"] }]);
    expect(s.messages.every((x) => x.handled)).toBe(true);
  });

  it("button taps are handled by code, then the bot asks the next question; summary comes with Confirm buttons", async () => {
    const s = setup();
    const model = scriptedTurns([
      [{ tools: [{ name: "add_to_cart", input: { item_id: s.ref("Zinger Burger"), quantity: 2 } }] }, { text: "Delivery ya pickup?" }],
      [{ text: "Payment kaise karein ge?" }], // after the Pickup button
      [{ tools: [{ name: "show_order_summary", input: {} }] }, { text: "" }], // after the payment button
    ]);
    const p = s.make(model);
    await p.handleInbound(s.trigger(s.inbound("2 zinger")));
    await p.handleInbound(
      s.trigger(s.inbound("🛍️ Pickup", "interactive", { interactive: { button_reply: { id: "order_type_pickup", title: "🛍️ Pickup" } } })),
    );
    const session = [...s.m.sessions.values()][0];
    expect(session.orderType).toBe("pickup");
    expect(s.sent.at(-1)).toEqual({ text: "Payment kaise karein ge?", buttons: ["payment_cod", "payment_card"] });
    await p.handleInbound(
      s.trigger(s.inbound("💵 Cash on delivery", "interactive", { interactive: { button_reply: { id: "payment_cod", title: "💵 Cash on delivery" } } })),
    );
    expect(s.sent.at(-1)?.buttons).toEqual(["confirm", "change", "cancel"]);
    expect(s.sent.at(-1)?.text).toContain("Rs 1,100");

    const noAi = scriptedTurns([[{ text: "should not run" }]]);
    await s.make(noAi).handleInbound(s.trigger(s.inbound("✅ Confirm", "interactive", { interactive: { button_reply: { id: "confirm", title: "✅ Confirm" } } })));
    expect(noAi.doGenerateCalls).toHaveLength(0);
    expect(s.m.orders).toHaveLength(1);
    expect(s.sent.at(-1)?.text).toBe(`✅ Order #${s.m.orders[0].orderNumber} mil gaya! Restaurant confirm karega to aap ko message aa jayega.`);
  });

  it("a location pin becomes the delivery location", async () => {
    const s = setup();
    const p = s.make(scriptedTurns([[{ text: "Location mil gayi! Qareebi nishani?" }]]));
    await p.handleInbound(s.trigger(s.inbound("Home · 24.81, 67.02", "location", { location: { latitude: 24.81, longitude: 67.02, name: "Home" } })));
    const session = [...s.m.sessions.values()][0];
    expect(session).toMatchObject({ orderType: "delivery", address: { latitude: 24.81, longitude: 67.02 } });
    // Our "[Customer shared a location pin]" note must not switch the customer's language.
    expect(session.language).toBe("roman_urdu");
    expect(s.m.logs[0].inputText).toContain("location pin");
  });

  it("images and voice notes get a polite 'please type' reply, no AI", async () => {
    const s = setup();
    const model = scriptedTurns([[{ text: "x" }]]);
    await s.make(model).handleInbound(s.trigger(s.inbound(null, "audio")));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(s.sent).toEqual([{ text: "Abhi sirf text messages samajh sakta hoon, please type kar dein 🙏", buttons: null }]);
  });

  it("handoff switches the bot off for the chat and tells the customer", async () => {
    const s = setup();
    const p = s.make(scriptedTurns([[{ tools: [{ name: "handoff_to_staff", input: { reason: "Customer asked for a person" } }] }, { text: "ok" }]]));
    await p.handleInbound(s.trigger(s.inbound("agent")));
    expect(s.conversation.botEnabled).toBe(false);
    expect(s.handoffs).toEqual(["Customer asked for a person"]);
    expect(s.sent.at(-1)?.text).toBe("Aap ki baat staff se karwa raha hoon, thori der mein jawab milega 🙏");
    // Next message: the bot stays quiet (staff have the chat).
    const model = scriptedTurns([[{ text: "x" }]]);
    await s.make(model).handleInbound(s.trigger(s.inbound("hello?")));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(s.sent).toHaveLength(1);
  });

  it("flood limit: more than 10 messages a minute → no reply for a minute (logged)", async () => {
    const s = setup();
    const model = scriptedTurns([[{ text: "x" }]]);
    let last = "";
    for (let i = 0; i < 11; i++) last = s.inbound(`spam ${i}`);
    await s.make(model).handleInbound(s.trigger(last));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(s.sent).toHaveLength(0);
    expect(s.conversation.botMutedUntil).not.toBeNull();
    expect(s.m.logs.at(-1)).toMatchObject({ errorType: "flood" });
  });

  it("over the monthly AI budget → new chats go straight to staff", async () => {
    const s = setup({ budget: { budget: 10, spent: 10.5 } });
    const model = scriptedTurns([[{ text: "x" }]]);
    await s.make(model).handleInbound(s.trigger(s.inbound("2 zinger")));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(s.conversation.botEnabled).toBe(false);
    expect(s.handoffs).toEqual(["Monthly AI budget reached"]);
    expect(s.m.logs.at(-1)).toMatchObject({ errorType: "budget" });
  });

  it("only one turn at a time per chat: a waiting handler leaves the batch to the running one", async () => {
    const s = setup();
    s.conversation.lockUntil = Date.parse("2026-11-10T12:10:00Z"); // another turn holds the lock
    const id = s.inbound("2 zinger");
    const model = scriptedTurns([[{ text: "x" }]]);
    const run = s.make(model).handleInbound(s.trigger(id));
    // Meanwhile the running turn handles our message:
    s.messages[0].handled = true;
    await run;
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
