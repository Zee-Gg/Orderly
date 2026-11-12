import { describe, expect, it } from "vitest";
import { DEMO_FAQS, DEMO_OFFERS } from "@/lib/menu/demo-menu";
import { formatPKR } from "@/lib/money";
import type { FaqRecord, OfferRecord } from "../knowledge";
import { buildMenuIndex, type MenuIndex } from "../menu-index";
import { BRANCH_ID, createMemoryBotStore, RESTAURANT_ID } from "../testing/memory-store";
import type { BotLanguage } from "../types";
import { runTool, type BotContext } from "./index";

type Opts = NonNullable<Parameters<typeof createMemoryBotStore>[0]>;

/** Karachi local time → Date. 2026-11-13 is a Friday, 2026-11-15 a Sunday, 2026-11-16 a Monday. */
const pk = (local: string) => new Date(`${local}+05:00`);

async function setup(opts: Opts & { now?: Date; language?: BotLanguage; demoKnowledge?: boolean } = {}) {
  const m = createMemoryBotStore(opts);
  if (opts.demoKnowledge) {
    // Offers point at item ids, which exist only after the store is built (opts are read lazily).
    opts.offers = DEMO_OFFERS.map(
      (o, i): OfferRecord => ({
        id: `offer-${i}`,
        branchId: null,
        title: o.title,
        titleUr: o.titleUr ?? null,
        description: o.description,
        menuItemId: m.itemIds[o.itemName],
        imagePath: null,
        startsAt: "2026-01-01T00:00:00Z",
        endsAt: null,
        daysOfWeek: o.daysOfWeek,
        startTime: o.startTime,
        endTime: o.endTime,
        isActive: true,
        sortOrder: i,
      }),
    );
    opts.faqs = DEMO_FAQS.map((f, i): FaqRecord => ({ id: `faq-${i}`, answerUr: null, isActive: true, sortOrder: i, ...f }));
  }
  const customer = m.addCustomer({ name: "Ali" });
  const session = await m.store.createSession({
    restaurantId: RESTAURANT_ID,
    branchId: BRANCH_ID,
    conversationId: null,
    customerId: customer.id,
    language: opts.language ?? "roman_urdu",
  });
  let idx: MenuIndex | null = null;
  const ctx: BotContext = {
    store: m.store,
    session,
    restaurant: m.restaurant,
    branch: m.branch,
    customer,
    now: () => opts.now ?? pk("2026-11-13T13:00:00"),
    menu: async () => (idx ??= buildMenuIndex(m.menu)),
    effects: { summary: null, order: null, handedOff: false, cancelled: false, media: [] },
  };
  const index = await ctx.menu();
  const ref = (name: string) => index.itemRef.get(m.itemIds[name])!;
  return { m, ctx, ref, run: (tool: string, input: unknown = {}) => runTool(ctx, tool, input) };
}

describe("send_menu", () => {
  it("sends up to 5 images, the first with the 'final prices' caption", async () => {
    const images = Array.from({ length: 7 }, (_, i) => ({ type: "image" as const, url: `https://cdn.test/m${i}.jpg`, fileName: `m${i}.jpg` }));
    const s = await setup({ menuMedia: [...images, { type: "pdf", url: "https://cdn.test/menu.pdf", fileName: "menu.pdf" }] });
    const r = await s.run("send_menu");
    expect(r).toMatchObject({ ok: true, sent: "menu_images", count: 5 });
    expect(s.ctx.effects.media).toHaveLength(6);
    expect(s.ctx.effects.media[0]).toEqual({ kind: "image", url: "https://cdn.test/m0.jpg", caption: "Final prices aap ke order summary mein confirm honge" });
    expect(s.ctx.effects.media[1]).toEqual({ kind: "image", url: "https://cdn.test/m1.jpg" });
    // Then the menu page link (Phase 8).
    expect(s.ctx.effects.media[5]).toEqual({ kind: "text", text: expect.stringMatching(/^Yahan se items select karein 👉 \S+\/m\/cheezious$/) });
  });

  it("no images → the PDF; nothing → a text menu with engine prices", async () => {
    const pdf = await setup({ menuMedia: [{ type: "pdf", url: "https://cdn.test/menu.pdf", fileName: "Menu.pdf" }], language: "english" });
    expect(await pdf.run("send_menu")).toMatchObject({ ok: true, sent: "menu_pdf" });
    expect(pdf.ctx.effects.media).toEqual([
      { kind: "text", text: expect.stringMatching(/^Pick your items here 👉 \S+\/m\/cheezious$/) }, // no images: link first
      { kind: "document", url: "https://cdn.test/menu.pdf", fileName: "Menu.pdf", caption: "Final prices are confirmed in your order summary" },
    ]);

    const text = await setup();
    expect(await text.run("send_menu")).toMatchObject({ ok: true, sent: "text_menu" });
    expect(text.ctx.effects.media[0]).toMatchObject({ kind: "text", text: expect.stringContaining("/m/cheezious") });
    const menu = text.ctx.effects.media[1];
    expect(menu.kind).toBe("text");
    const body = menu.kind === "text" ? menu.text : "";
    expect(body).toContain("Zinger Burger — Rs 550");
    expect(body).toContain("Chicken Tikka Pizza — from Rs 899");
    expect(body).not.toContain("Loaded Fries"); // sold out at this branch
  });
});

describe("send_item_photo", () => {
  it("photo with 'name — price' from the pricing engine", async () => {
    const s = await setup({ photos: ["Zinger Burger"] });
    const r = await s.run("send_item_photo", { item_id: s.ref("Zinger Burger") });
    expect(r).toMatchObject({ ok: true, price: "Rs 550" });
    expect(s.ctx.effects.media).toEqual([{ kind: "image", url: `https://photos.test/${s.m.itemIds["Zinger Burger"]}.jpg`, caption: "Zinger Burger — Rs 550" }]);
  });

  it("no photo → no_photo with the description, nothing sent", async () => {
    const s = await setup();
    const r = await s.run("send_item_photo", { item_id: s.ref("Chicken Karahi") });
    expect(r).toMatchObject({ ok: false, error: "no_photo", price: "from Rs 1,600", description: expect.stringContaining("karahi") });
    expect(s.ctx.effects.media).toEqual([]);
  });
});

describe("get_bestsellers", () => {
  it("tagged bestsellers first, then 30-day top sellers, max 5, only available items", async () => {
    const s = await setup({
      bestsellers: [
        { itemName: "Loaded Fries", quantity: 99 }, // sold out here → skipped
        { itemName: "Mint Margarita", quantity: 40 },
        { itemName: "Zinger Burger", quantity: 30 }, // already tagged
        { itemName: "Garlic Naan", quantity: 20 },
        { itemName: "Raita", quantity: 10 },
      ],
    });
    const r = await s.run("get_bestsellers");
    const names = (r as unknown as { bestsellers: { name: string; price: string }[] }).bestsellers.map((b) => b.name);
    expect(names).toEqual(["Chicken Tikka Pizza", "Zinger Burger", "Chicken Biryani", "Mint Margarita", "Garlic Naan"]);
    expect((r as unknown as { bestsellers: { price: string }[] }).bestsellers[1].price).toBe("Rs 550");
  });
});

describe("get_offers", () => {
  it("Friday lunchtime: Friday Deal AND Student Deal, with engine prices", async () => {
    const s = await setup({ demoKnowledge: true, now: pk("2026-11-13T13:00:00") });
    const r = (await s.run("get_offers")) as { ok: true; offers: { title: string; price: string; item_id: string }[] };
    expect(r.offers.map((o) => [o.title, o.price])).toEqual([
      ["Friday Deal", formatPKR(119900)],
      ["Student Deal", formatPKR(59900)],
    ]);
    expect(r.offers[0].item_id).toBe(s.ref("Friday Deal: 2 Zinger + 1.5L Coke"));
  });

  it("Sunday: no offers → says so (never invent one)", async () => {
    const s = await setup({ demoKnowledge: true, now: pk("2026-11-15T13:00:00") });
    expect(await s.run("get_offers")).toMatchObject({ ok: true, offers: [], message: expect.stringContaining("NO offers") });
  });

  it("Monday 5 pm: Student Deal is over for the day", async () => {
    const s = await setup({ demoKnowledge: true, now: pk("2026-11-16T17:00:00") });
    expect(await s.run("get_offers")).toMatchObject({ offers: [] });
  });

  it("offer whose item is sold out, or for another branch → hidden", async () => {
    const s = await setup({ demoKnowledge: true });
    s.m.menu.categories.flatMap((c) => c.items).find((i) => i.name === "Student Deal")!.isAvailable = false;
    s.ctx.menu = async () => buildMenuIndex(s.m.menu);
    const r = (await s.run("get_offers")) as unknown as { offers: { title: string }[] };
    expect(r.offers.map((o) => o.title)).toEqual(["Friday Deal"]);
  });
});

describe("search_faqs", () => {
  it("answers from the saved FAQs only", async () => {
    const s = await setup({ demoKnowledge: true });
    const r = await s.run("search_faqs", { query: "parking hai?" });
    expect(r).toMatchObject({ ok: true, answers: [{ question: "Parking available?", answer: expect.stringContaining("free parking") }] });
  });

  it("no match → NO_MATCH (the bot asks staff)", async () => {
    const s = await setup({ demoKnowledge: true });
    expect(await s.run("search_faqs", { query: "wifi password kya hai" })).toMatchObject({ ok: false, error: "NO_MATCH" });
  });
});

describe("send_location", () => {
  it("pin when the branch has coordinates", async () => {
    const s = await setup();
    expect(await s.run("send_location")).toMatchObject({ ok: true, sent: "location_pin" });
    expect(s.ctx.effects.media).toEqual([
      { kind: "location", latitude: 24.8138, longitude: 67.0299, name: "Cheezious — Clifton", address: "Block 5, Clifton, Clifton" },
    ]);
  });

  it("no pin → the address as text (+ Maps link); nothing → NO_LOCATION", async () => {
    const text = await setup({ branch: { latitude: null, longitude: null, mapsUrl: "https://maps.app.goo.gl/x" } });
    expect(await text.run("send_location")).toMatchObject({ ok: true, sent: "address_text" });
    expect(text.ctx.effects.media[0]).toEqual({ kind: "text", text: "📍 Cheezious — Clifton\nBlock 5, Clifton, Clifton\nhttps://maps.app.goo.gl/x" });

    const none = await setup({ branch: { latitude: null, longitude: null, address: null, area: null } });
    expect(await none.run("send_location")).toMatchObject({ ok: false, error: "NO_LOCATION" });
  });
});

describe("restaurant info + payments", () => {
  it("delivery time = prep + delivery minutes; payment methods and dine-in from settings", async () => {
    const s = await setup({ restaurant: { paymentMethods: ["cod"], dineInAvailable: false } });
    expect(await s.run("get_restaurant_info")).toMatchObject({
      delivery_time: "about 50 minutes",
      pickup_ready_time: "about 20 minutes",
      payment_methods: ["cash on delivery"],
      dine_in_available: false,
      has_location_pin: true,
    });
    expect(await s.run("set_payment_method", { payment_method: "card_on_delivery" })).toMatchObject({ ok: false, error: "PAYMENT_NOT_ACCEPTED" });
  });
});
