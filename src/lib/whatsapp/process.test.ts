import { describe, expect, it, vi } from "vitest";
import { isOpenAt, type OpeningHours } from "@/lib/opening-hours";
import { buildGreeting } from "./greeting";
import { createMemoryStore } from "./memory-store";
import { parseWebhookPayload } from "./payload";
import { processWebhookPayload } from "./process";
import type { GreetingContext } from "./store";

const PHONE_NUMBER_ID = "123456789";
// Sunday 8 Nov 2026, 3 PM in Karachi
const NOW = Date.parse("2026-11-08T10:00:00Z");
const HOUR = 3600_000;

const everyDay = (open: string, close: string) =>
  Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { closed: false, open, close }])) as OpeningHours;

const greeting: GreetingContext = {
  restaurantName: "Tandoori Junction",
  phone: "+923001234567",
  timezone: "Asia/Karachi",
  branchIsOpen: true,
  openingHours: everyDay("12:00", "02:00"),
};

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
    greeting,
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
  it("saves a message, creates the customer, and greets once", async () => {
    const { mem, fetch, deps } = setup();
    const s = await processWebhookPayload(deps, textPayload("wamid.A"));
    expect(s).toMatchObject({ saved: 1, duplicates: 0, autoReplies: 1, errors: [] });
    expect(mem.customers).toEqual([expect.objectContaining({ phone: "+923331112222", name: "Ayesha" })]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const reply = mem.messages.find((m) => m.direction === "outbound")!;
    expect(reply.body).toContain("*Tandoori Junction* mein khush aamdeed");
  });

  it("skips duplicate deliveries of the same message (no second save, no second reply)", async () => {
    const { mem, fetch, deps } = setup();
    await processWebhookPayload(deps, textPayload("wamid.DUP"));
    const again = await processWebhookPayload(deps, textPayload("wamid.DUP"));
    expect(again).toMatchObject({ saved: 0, duplicates: 1, autoReplies: 0 });
    expect(mem.messages.filter((m) => m.direction === "inbound")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("greets at most once every 6 hours per conversation", async () => {
    let now = NOW;
    const { fetch, deps } = setup(() => now);
    await processWebhookPayload(deps, textPayload("m1", "hi", undefined, now / 1000));
    now += 2 * HOUR;
    await processWebhookPayload(deps, textPayload("m2", "hello?", undefined, now / 1000));
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 5 * HOUR;
    await processWebhookPayload(deps, textPayload("m3", "salam", undefined, now / 1000));
    expect(fetch).toHaveBeenCalledTimes(2);
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
    const reply = mem.messages.find((m) => m.direction === "outbound")!;
    await processWebhookPayload(deps, statusPayload(reply.waMessageId!, "read"));
    expect(reply.status).toBe("read");
    // A late "delivered" must not move it back.
    const late = await processWebhookPayload(deps, statusPayload(reply.waMessageId!, "delivered"));
    expect(late.statuses).toBe(0);
    expect(reply.status).toBe("read");
  });
});

describe("greeting and opening hours", () => {
  it("open: says the AI assistant is coming and gives the phone", () => {
    const text = buildGreeting(greeting, new Date(NOW));
    expect(text).toContain("Abhi order ke liye call karein: 0300-1234567");
    expect(text).toContain("Welcome to Tandoori Junction");
  });

  it("closed by the switch or by the hours: says so and lists hours", () => {
    const closedSwitch = buildGreeting({ ...greeting, branchIsOpen: false }, new Date(NOW));
    expect(closedSwitch).toContain("we're closed right now");
    expect(closedSwitch).toContain("Every day: 12 PM – 2 AM (next day)");
    // 8 AM Karachi = 03:00 UTC: outside 12:00–02:00
    const early = buildGreeting(greeting, new Date("2026-11-08T03:00:00Z"));
    expect(early).toContain("we're closed right now");
  });

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
