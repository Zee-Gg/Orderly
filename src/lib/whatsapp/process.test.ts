import { describe, expect, it, vi } from "vitest";
import { isOpenAt, type OpeningHours } from "@/lib/opening-hours";
import { createMemoryStore } from "./memory-store";
import { parseWebhookPayload } from "./payload";
import { processWebhookPayload } from "./process";

const PHONE_NUMBER_ID = "123456789";
// Sunday 8 Nov 2026, 3 PM in Karachi
const NOW = Date.parse("2026-11-08T10:00:00Z");

const everyDay = (open: string, close: string) =>
  Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { closed: false, open, close }])) as OpeningHours;

function textPayload(id: string, body = "Menu bhejein", from = "923331112222", ts = NOW / 1000) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15551556437", phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ profile: { name: "Ayesha" }, wa_id: from }],
              messages: [{ from, id, timestamp: String(Math.floor(ts)), type: "text", text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

function statusPayload(id: string, status: string) {
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, statuses: [{ id, status, timestamp: "1", recipient_id: "923331112222" }] } }] }],
  };
}

function setup(now = () => NOW) {
  const mem = createMemoryStore({
    now,
    accounts: [{ id: "a1", restaurantId: "r1", branchId: null, phoneNumberId: PHONE_NUMBER_ID, isActive: true, accessTokenEncrypted: "x" }],
  });
  let n = 0;
  const fetch = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: `wamid.out${++n}` }] }), { status: 200 }));
  const deps = { store: mem.store, fetch, now, sleep: async () => {}, decrypt: () => "token" };
  return { mem, fetch, deps };
}

describe("parseWebhookPayload", () => {
  it("reads text, location, interactive and media messages", () => {
    const p = textPayload("wamid.1");
    const msgs = p.entry[0].changes[0].value.messages as unknown[];
    msgs.push(
      { from: "923331112222", id: "wamid.2", timestamp: "1", type: "location", location: { latitude: 31.5, longitude: 74.3, name: "Home" } },
      { from: "923331112222", id: "wamid.3", timestamp: "1", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "y", title: "Yes" } } },
      { from: "923331112222", id: "wamid.4", timestamp: "1", type: "audio", audio: { id: "MEDIA1" } },
      { from: "923331112222", id: "wamid.5", timestamp: "1", type: "reaction" },
    );
    const parsed = parseWebhookPayload(p);
    expect(parsed.messages.map((m) => [m.type, m.body, m.mediaId])).toEqual([
      ["text", "Menu bhejein", null],
      ["location", "Home · 31.5, 74.3", null],
      ["interactive", "Yes", null],
      ["audio", null, "MEDIA1"],
      ["unknown", "[reaction]", null],
    ]);
    expect(parsed.messages[0]).toMatchObject({ phoneNumberId: PHONE_NUMBER_ID, profileName: "Ayesha", waId: "923331112222" });
  });

  it("ignores garbage without throwing", () => {
    expect(parseWebhookPayload("nope").messages).toEqual([]);
    expect(parseWebhookPayload({ entry: [{ changes: [{ field: "messages", value: {} }] }] }).problems.length).toBe(1);
  });
});

describe("processWebhookPayload", () => {
  it("saves a message, creates the customer, and hands the chat to the bot once", async () => {
    const { mem, deps } = setup();
    const onInbound = vi.fn(async () => {});
    const s = await processWebhookPayload({ ...deps, onInbound }, textPayload("wamid.A"));
    expect(s).toMatchObject({ saved: 1, duplicates: 0, botRuns: 1, errors: [] });
    expect(mem.customers).toEqual([expect.objectContaining({ phone: "+923331112222", name: "Ayesha" })]);
    const saved = mem.messages.find((m) => m.direction === "inbound")!;
    expect(onInbound).toHaveBeenCalledWith({ restaurantId: "r1", branchId: null, conversationId: saved.conversationId, messageId: saved.id });
  });

  it("skips duplicate deliveries of the same message (no second save, no second bot run)", async () => {
    const { mem, deps } = setup();
    const onInbound = vi.fn(async () => {});
    await processWebhookPayload({ ...deps, onInbound }, textPayload("wamid.DUP"));
    const again = await processWebhookPayload({ ...deps, onInbound }, textPayload("wamid.DUP"));
    expect(again).toMatchObject({ saved: 0, duplicates: 1, botRuns: 0 });
    expect(mem.messages.filter((m) => m.direction === "inbound")).toHaveLength(1);
    expect(onInbound).toHaveBeenCalledTimes(1);
  });

  it("several messages of one chat in one delivery → one bot run with the newest", async () => {
    const { mem, deps } = setup();
    const onInbound = vi.fn(async () => {});
    const p = textPayload("m1", "2 zinger");
    (p.entry[0].changes[0].value.messages as unknown[]).push({ from: "923331112222", id: "m2", timestamp: "1", type: "text", text: { body: "aur coke" } });
    await processWebhookPayload({ ...deps, onInbound }, p);
    expect(onInbound).toHaveBeenCalledTimes(1);
    const newest = mem.messages.find((m) => m.waMessageId === "m2")!;
    expect(onInbound).toHaveBeenCalledWith(expect.objectContaining({ messageId: newest.id }));
  });

  it("a failing bot never breaks webhook processing", async () => {
    const { deps } = setup();
    const s = await processWebhookPayload({ ...deps, onInbound: async () => { throw new Error("AI down"); } }, textPayload("wamid.F"));
    expect(s).toMatchObject({ saved: 1, botRuns: 0, errors: ["bot: AI down"] });
  });

  it("ignores numbers that are not connected", async () => {
    const { mem, deps } = setup();
    const p = textPayload("wamid.X");
    p.entry[0].changes[0].value.metadata.phone_number_id = "999";
    const s = await processWebhookPayload(deps, p);
    expect(s).toMatchObject({ saved: 0, ignored: 1 });
    // Visible on the webhook event row, so a wrong phone number ID is easy to spot.
    expect(s.errors.join()).toContain("no connected restaurant for phone_number_id 999");
    expect(mem.messages).toHaveLength(0);
  });

  it("logs each step in order", async () => {
    const { deps } = setup();
    const steps: string[] = [];
    await processWebhookPayload(deps, textPayload("wamid.log1"), (step) => steps.push(step));
    expect(steps.slice(0, 4)).toEqual(["parsed", "restaurant found", "customer saved", "message saved"]);
  });

  it("updates outbound status forward only", async () => {
    const { mem, deps } = setup();
    await processWebhookPayload(deps, textPayload("wamid.in"));
    const conversationId = mem.messages[0].conversationId;
    await mem.store.insertOutbound({ restaurantId: "r1", conversationId, body: "Hi", status: "sent", waMessageId: "wamid.out1" });
    const reply = mem.messages.find((m) => m.direction === "outbound")!;
    await processWebhookPayload(deps, statusPayload(reply.waMessageId!, "read"));
    expect(reply.status).toBe("read");
    // A late "delivered" must not move it back.
    const late = await processWebhookPayload(deps, statusPayload(reply.waMessageId!, "delivered"));
    expect(late.statuses).toBe(0);
    expect(reply.status).toBe("read");
  });
});

describe("opening hours", () => {
  it("isOpenAt handles closing after midnight", () => {
    const hours = everyDay("12:00", "02:00");
    expect(isOpenAt(hours, new Date("2026-11-08T20:30:00Z"), "Asia/Karachi")).toBe(true); // 1:30 AM Mon
    expect(isOpenAt(hours, new Date("2026-11-08T21:30:00Z"), "Asia/Karachi")).toBe(false); // 2:30 AM
    expect(isOpenAt(hours, new Date("2026-11-08T07:00:00Z"), "Asia/Karachi")).toBe(true); // 12 PM
    const sundayClosed = { ...hours, sun: { closed: true as const } };
    expect(isOpenAt(sundayClosed, new Date("2026-11-08T10:00:00Z"), "Asia/Karachi")).toBe(false); // Sun 3 PM
    // Saturday's late hours still count early Sunday morning
    expect(isOpenAt(sundayClosed, new Date("2026-11-07T20:30:00Z"), "Asia/Karachi")).toBe(true); // Sun 1:30 AM
  });
});
