import { afterEach, describe, expect, it, vi } from "vitest";
import { emitOrderEvent, setOrderEventHandler, type EmittedEvent } from "@/lib/orders/events";
import { createMemoryStore } from "./memory-store";
import { announcedStatus, orderStatusMessage, sendOrderUpdate } from "./order-updates";
import type { OrderMessageContext } from "./store";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const HOUR = 3600_000;
const bot = { type: "bot", userId: null, role: null } as const;
const account = { id: "acc-1", restaurantId: "rest-1", branchId: null, phoneNumberId: "111", isActive: true, accessTokenEncrypted: "enc" };
const order = { id: "order-1", restaurantId: "rest-1", branchId: "branch-1", orderNumber: 1045 };

function ctx(over: Partial<OrderMessageContext> = {}): OrderMessageContext {
  return {
    orderNumber: 1045,
    orderType: "delivery",
    customerPhone: "+923001234567",
    customerWaId: null,
    expectedReadyAt: new Date(NOW + 25 * 60_000).toISOString(),
    defaultPrepMinutes: 20,
    cancelReason: null,
    statusMessages: {},
    ...over,
  };
}

async function setup(lastCustomerMessageHoursAgo: number | null, over: Partial<OrderMessageContext> = {}) {
  const mem = createMemoryStore({ accounts: [{ ...account }], orders: { "order-1": ctx(over) }, now: () => NOW });
  if (lastCustomerMessageHoursAgo !== null) {
    await mem.store.recordInbound(
      "rest-1",
      {
        phoneNumberId: "111", waId: "923001234567", profileName: "Ali", waMessageId: "wamid.in", type: "text", body: "hi",
        mediaId: null, sentAt: new Date(NOW - lastCustomerMessageHoursAgo * HOUR).toISOString(), raw: {},
      },
      "+923001234567",
    );
  }
  const fetch = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 }));
  const deps = { store: mem.store, fetch, now: () => NOW, decrypt: () => "token", sleep: async () => {} };
  return { mem, fetch, deps };
}

const statusEvent = (to: EmittedEvent["to"], data?: Record<string, unknown>): EmittedEvent => ({
  kind: to === "cancelled" ? "cancelled" : "status_changed",
  to,
  actor: bot,
  data,
});

describe("orderStatusMessage", () => {
  it("has the right text for each status", () => {
    const base = { orderNumber: 1045, orderType: "pickup" as const };
    expect(orderStatusMessage({ ...base, status: "accepted", minutes: 25 })).toMatch(/^✅ Order #1045 confirm ho gaya! Tayyar hone mein ~25 min\./);
    expect(orderStatusMessage({ ...base, status: "preparing" })).toMatch(/^👨‍🍳 Order #1045 tayyar ho raha hai\./);
    expect(orderStatusMessage({ ...base, status: "ready" })).toMatch(/^🛍️ Order #1045 ready hai, aa kar le jayein\./);
    expect(orderStatusMessage({ ...base, status: "out_for_delivery" })).toMatch(/^🛵 Order #1045 raaste mein hai\./);
    expect(orderStatusMessage({ ...base, status: "delivered" })).toMatch(/^🎉 Order #1045 deliver ho gaya\. Shukriya!/);
    expect(orderStatusMessage({ ...base, status: "cancelled", cancelReason: "out_of_stock" })).toMatch(
      /^❌ Order #1045 cancel ho gaya\. Wajah: item available nahi hai/,
    );
  });

  it("every message has an English line", () => {
    for (const status of ["accepted", "preparing", "ready", "out_for_delivery", "delivered", "cancelled"] as const) {
      expect(orderStatusMessage({ status, orderNumber: 1, orderType: "pickup" })).toMatch(/\nYour order/);
    }
  });

  it("only pickup orders get the 'ready' message", () => {
    expect(orderStatusMessage({ status: "ready", orderNumber: 1, orderType: "delivery" })).toBeNull();
    expect(orderStatusMessage({ status: "ready", orderNumber: 1, orderType: "dine_in" })).toBeNull();
  });

  it("never tells the customer internal cancel reasons", () => {
    const text = orderStatusMessage({ status: "cancelled", orderNumber: 1, orderType: "pickup", cancelReason: "fake_order" })!;
    expect(text).not.toMatch(/fake/i);
    expect(text).toContain("restaurant ne cancel kiya");
  });

  it("leaves out the time when it is unknown", () => {
    expect(orderStatusMessage({ status: "accepted", orderNumber: 1, orderType: "pickup", minutes: null })).not.toContain("min");
  });

  it("has no message for statuses customers don't need", () => {
    expect(orderStatusMessage({ status: "completed", orderNumber: 1, orderType: "pickup" })).toBeNull();
    expect(announcedStatus({ kind: "edited", actor: bot })).toBeNull();
    expect(announcedStatus({ kind: "created", to: "awaiting_acceptance", actor: bot })).toBeNull();
    expect(announcedStatus({ kind: "created", to: "accepted", actor: bot })).toBe("accepted");
  });
});

describe("sendOrderUpdate", () => {
  it("sends inside the 24h window and links the message to the order", async () => {
    const { mem, fetch, deps } = await setup(2);
    const res = await sendOrderUpdate(deps, order, statusEvent("accepted"));
    expect(res).toMatchObject({ sent: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const out = mem.messages.at(-1)!;
    expect(out).toMatchObject({ direction: "outbound", status: "sent", orderId: "order-1" });
    expect(out.body).toContain("Tayyar hone mein ~25 min");
  });

  it("skips (and logs) outside the 24h window — no template, nothing sent", async () => {
    const { mem, fetch, deps } = await setup(30);
    const res = await sendOrderUpdate(deps, order, statusEvent("preparing"));
    expect(res).toMatchObject({ sent: false, reason: "skipped: outside 24h window" });
    expect(fetch).not.toHaveBeenCalled();
    expect(mem.messages.at(-1)).toMatchObject({ status: "skipped", error: "outside 24h window", orderId: "order-1" });
  });

  it("skips customers who never messaged", async () => {
    const { mem, fetch, deps } = await setup(null);
    expect(await sendOrderUpdate(deps, order, statusEvent("delivered"))).toMatchObject({ sent: false, reason: "skipped: outside 24h window" });
    expect(fetch).not.toHaveBeenCalled();
    expect(mem.messages).toHaveLength(0);
  });

  it("respects the restaurant's on/off setting", async () => {
    const { fetch, deps } = await setup(1, { statusMessages: { preparing: false } });
    expect(await sendOrderUpdate(deps, order, statusEvent("preparing"))).toMatchObject({ sent: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(await sendOrderUpdate(deps, order, statusEvent("out_for_delivery"))).toMatchObject({ sent: true });
  });

  it("does nothing without WhatsApp or without a customer phone", async () => {
    const a = await setup(1, { customerPhone: null });
    expect(await sendOrderUpdate(a.deps, order, statusEvent("accepted"))).toMatchObject({ reason: "customer has no WhatsApp number" });
    const b = await setup(1);
    b.mem.accounts[0].isActive = false;
    expect(await sendOrderUpdate(b.deps, order, statusEvent("accepted"))).toMatchObject({ reason: "WhatsApp is not connected" });
  });

  it("uses the cancel reason from the event", async () => {
    const { mem, deps } = await setup(1);
    await sendOrderUpdate(deps, order, statusEvent("cancelled", { reason: "restaurant_closed" }));
    expect(mem.messages.at(-1)?.body).toContain("restaurant band hai");
  });
});

describe("emitOrderEvent", () => {
  afterEach(() => setOrderEventHandler(null, (task) => void task()));

  it("never waits for (or fails because of) the handler", async () => {
    let finish!: () => void;
    const slow = new Promise<void>((r) => (finish = r));
    const ran = vi.fn();
    setOrderEventHandler(async () => {
      await slow;
      ran();
    });
    await emitOrderEvent(order, statusEvent("accepted")); // returns while the handler is still waiting
    expect(ran).not.toHaveBeenCalled();
    finish();
    await slow;

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setOrderEventHandler(async () => {
      throw new Error("WhatsApp down");
    });
    await expect(emitOrderEvent(order, statusEvent("accepted"))).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
