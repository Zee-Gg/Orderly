import { describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "./memory-store";
import { createSender, isInside24hWindow } from "./send";
import type { FetchLike } from "./graph";
import type { InboundMessage } from "./payload";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const HOUR = 3600_000;

const account = {
  id: "acc-1",
  restaurantId: "rest-1",
  branchId: null,
  phoneNumberId: "111111",
  isActive: true,
  accessTokenEncrypted: "enc",
};

function inbound(sentAt: string, id = "wamid.in1"): InboundMessage {
  return { phoneNumberId: "111111", waId: "923001234567", profileName: "Ali", waMessageId: id, type: "text", body: "hi", mediaId: null, sentAt, raw: {} };
}

function graphOk(id = "wamid.out1") {
  return new Response(JSON.stringify({ messages: [{ id }] }), { status: 200 });
}

describe("isInside24hWindow", () => {
  it("is true within 24 hours of the last customer message", () => {
    expect(isInside24hWindow({ lastCustomerMessageAt: new Date(NOW - 23 * HOUR).toISOString() }, NOW)).toBe(true);
  });
  it("is false after 24 hours, or with no customer message", () => {
    expect(isInside24hWindow({ lastCustomerMessageAt: new Date(NOW - 24 * HOUR - 1).toISOString() }, NOW)).toBe(false);
    expect(isInside24hWindow({ lastCustomerMessageAt: null }, NOW)).toBe(false);
    expect(isInside24hWindow(null, NOW)).toBe(false);
  });
});

describe("sendText", () => {
  async function setup(lastMessageHoursAgo: number) {
    const mem = createMemoryStore({ accounts: [account] });
    await mem.store.recordInbound("rest-1", inbound(new Date(NOW - lastMessageHoursAgo * HOUR).toISOString()), "+923001234567");
    return mem;
  }

  it("skips (and saves as skipped) outside the 24h window, without calling WhatsApp", async () => {
    const mem = await setup(30);
    const fetch = vi.fn();
    const { sendText } = createSender({ store: mem.store, fetch, now: () => NOW, decrypt: () => "token" });
    const res = await sendText("rest-1", "923001234567", "Hello");
    expect(res).toMatchObject({ ok: false, status: "skipped", error: "outside 24h window" });
    expect(fetch).not.toHaveBeenCalled();
    expect(mem.messages.at(-1)).toMatchObject({ direction: "outbound", status: "skipped", error: "outside 24h window" });
  });

  it("sends inside the window and saves the wa_message_id", async () => {
    const mem = await setup(2);
    const fetch = vi.fn(async () => graphOk("wamid.abc"));
    const { sendText } = createSender({ store: mem.store, fetch, now: () => NOW, decrypt: () => "token" });
    const res = await sendText("rest-1", "923001234567", "Hello");
    expect(res).toMatchObject({ ok: true, status: "sent", waMessageId: "wamid.abc" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mem.messages.at(-1)).toMatchObject({ status: "sent", waMessageId: "wamid.abc", body: "Hello" });
  });

  it("retries 5xx/network errors up to 3 times, then saves failed", async () => {
    const mem = await setup(1);
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockImplementation(async () => new Response(JSON.stringify({ error: { message: "Service unavailable" } }), { status: 503 }));
    const sleep = vi.fn(async () => {});
    const { sendText } = createSender({ store: mem.store, fetch, sleep, now: () => NOW, decrypt: () => "token" });
    const res = await sendText("rest-1", "923001234567", "Hello");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(res).toMatchObject({ ok: false, status: "failed" });
    expect(mem.messages.at(-1)).toMatchObject({ status: "failed", error: expect.stringContaining("Service unavailable") });
  });

  it("recovers when a retry succeeds", async () => {
    const mem = await setup(1);
    const fetch = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(graphOk("wamid.retry"));
    const { sendText } = createSender({ store: mem.store, fetch, sleep: async () => {}, now: () => NOW, decrypt: () => "token" });
    expect(await sendText("rest-1", "923001234567", "Hi")).toMatchObject({ ok: true, waMessageId: "wamid.retry" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never saves the access token inside an error message", async () => {
    const mem = await setup(1);
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 190, message: "Malformed access token EAAGsecretTOKEN123456" } }), { status: 400 }),
    );
    const { sendText } = createSender({ store: mem.store, fetch, now: () => NOW, decrypt: () => "EAAGsecretTOKEN123456" });
    const res = await sendText("rest-1", "923001234567", "Hi");
    expect(res.ok).toBe(false);
    expect(JSON.stringify(mem.messages)).not.toContain("EAAGsecretTOKEN123456");
    expect(mem.messages.at(-1)?.error).toContain("[token]");
  });

  it("does not retry 4xx errors (bad token, bad number)", async () => {
    const mem = await setup(1);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token" } }), { status: 401 }));
    const { sendText } = createSender({ store: mem.store, fetch, sleep: async () => {}, now: () => NOW, decrypt: () => "token" });
    const res = await sendText("rest-1", "923001234567", "Hi");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: false, status: "failed", error: expect.stringContaining("Invalid OAuth") });
  });
});

describe("send helpers (Phase 7)", () => {
  async function sender(hoursAgo: number) {
    const mem = createMemoryStore({ accounts: [account] });
    await mem.store.recordInbound("rest-1", inbound(new Date(NOW - hoursAgo * HOUR).toISOString()), "+923001234567");
    let n = 0;
    const fetch = vi.fn<FetchLike>(async () => graphOk(`wamid.${++n}`));
    return { mem, fetch, s: createSender({ store: mem.store, fetch, now: () => NOW, decrypt: () => "token" }) };
  }
  const sentBody = (fetch: { mock: { calls: [string, RequestInit?][] } }) =>
    JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string);
  const to = ["rest-1", "923001234567"] as const;

  it("builds the right Graph API body for each helper", async () => {
    const { s, fetch, mem } = await sender(1);
    await s.sendImage(...to, "https://example.com/menu.jpg", "Menu");
    expect(sentBody(fetch)).toMatchObject({ to: "923001234567", type: "image", image: { link: "https://example.com/menu.jpg", caption: "Menu" } });
    expect(mem.messages.at(-1)).toMatchObject({ type: "image", body: "Menu", mediaUrl: "https://example.com/menu.jpg" });

    await s.sendDocument(...to, "https://example.com/bill.pdf", "bill.pdf");
    expect(sentBody(fetch)).toMatchObject({ type: "document", document: { link: "https://example.com/bill.pdf", filename: "bill.pdf" } });

    await s.sendLocation(...to, 24.8138, 67.0299, "Clifton branch", "Block 5, Clifton");
    expect(sentBody(fetch)).toMatchObject({ type: "location", location: { latitude: 24.8138, longitude: 67.0299, name: "Clifton branch" } });

    await s.sendInteractiveButtons(...to, "Confirm order?", [{ id: "yes", title: "Haan" }, { id: "no", title: "Nahi" }]);
    expect(sentBody(fetch)).toMatchObject({
      type: "interactive",
      interactive: { type: "button", body: { text: "Confirm order?" }, action: { buttons: [{ type: "reply", reply: { id: "yes", title: "Haan" } }, {}] } },
    });

    await s.sendInteractiveList(...to, "Choose a size", "Sizes", [{ title: "Pizza", rows: [{ id: "s", title: "Small" }, { id: "l", title: "Large" }] }]);
    expect(sentBody(fetch)).toMatchObject({ type: "interactive", interactive: { type: "list", action: { button: "Sizes" } } });
    expect(mem.messages.at(-1)).toMatchObject({ type: "interactive", status: "sent" });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("every helper skips outside the 24h window without calling WhatsApp", async () => {
    const { s, fetch, mem } = await sender(25);
    const results = await Promise.all([
      s.sendImage(...to, "https://example.com/a.jpg"),
      s.sendDocument(...to, "https://example.com/a.pdf", "a.pdf"),
      s.sendLocation(...to, 24.8, 67.0),
      s.sendInteractiveButtons(...to, "Hi", [{ id: "a", title: "A" }]),
      s.sendInteractiveList(...to, "Hi", "Open", [{ rows: [{ id: "a", title: "A" }] }]),
    ]);
    expect(results.every((r) => r.status === "skipped")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(mem.messages.filter((m) => m.status === "skipped")).toHaveLength(5);
  });

  it("rejects invalid messages before sending (Meta limits)", async () => {
    const { s, fetch } = await sender(1);
    const four = [1, 2, 3, 4].map((i) => ({ id: `${i}`, title: `B${i}` }));
    expect(await s.sendInteractiveButtons(...to, "Pick", four)).toMatchObject({ ok: false, status: "failed" });
    expect(await s.sendImage(...to, "http://insecure.example.com/a.jpg")).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});
