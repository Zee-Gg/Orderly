import { z } from "zod";
import type { BranchMenuItem } from "@/lib/menu/pricing";
import { isOfferActiveAt, mapsLinkFor, matchFaqs, type OfferRecord } from "../knowledge";
import { findItem, money, type MenuIndex } from "../menu-index";
import { menuPageUrl } from "@/lib/menu-page/links";
import { t } from "../texts";
import { fail, type BotContext, type ToolResult } from "./context";

/**
 * What the bot knows besides ordering: menu images, dish photos, bestsellers,
 * offers, FAQs, location. Media is not sent here: it is queued on
 * ctx.effects.media and the channel (WhatsApp / playground) delivers it.
 * Every price comes from the pricing engine (the branch menu).
 */
export const itemIdSchema = z.object({ item_id: z.string().trim().min(1).max(60).describe("Item ref, e.g. 'I3'") });
export const faqQuerySchema = z.object({ query: z.string().trim().min(2).max(200).describe("The customer's question, in their words") });

const MAX_MENU_IMAGES = 5;

/** "Rs 550", or "from Rs 899" when the item has sizes. */
export function priceLabel(item: BranchMenuItem): string | null {
  if (item.sizes.length) {
    const from = Math.min(...item.sizes.map((s) => s.price));
    return `from ${money(from)}`;
  }
  return money(item.price);
}

function menuItems(idx: MenuIndex) {
  return [...idx.items.values()].map((x) => x.item);
}

/** Text menu when no images were uploaded: categories, items, starting prices. */
function textMenu(idx: MenuIndex, title: string): string {
  const lines = [title];
  for (const c of idx.menu.categories) {
    const items = c.items.filter((i) => i.isAvailable);
    if (!items.length) continue;
    lines.push("", `*${c.name}*`);
    for (const i of items) lines.push(`• ${i.name} — ${priceLabel(i) ?? ""}`);
  }
  return lines.join("\n");
}

export async function sendMenuTool(ctx: BotContext): Promise<ToolResult> {
  const tx = t(ctx.session.language);
  const media = await ctx.store.getMenuMedia(ctx.session.restaurantId, ctx.session.branchId);
  const images = media.filter((m) => m.type === "image").slice(0, MAX_MENU_IMAGES);
  const pdf = media.find((m) => m.type === "pdf");
  // The menu page: customers tap items there and send the cart back with a code (Phase 8).
  const link = { kind: "text" as const, text: tx.menuPageLink(menuPageUrl(ctx.restaurant.slug)) };
  if (images.length) {
    images.forEach((m, i) => ctx.effects.media.push({ kind: "image", url: m.url, ...(i === 0 ? { caption: tx.menuCaption } : {}) }));
    ctx.effects.media.push(link);
    return { ok: true, sent: "menu_images", count: images.length, instruction: "Menu and menu page link sent. Briefly ask what they'd like to order (one line)." };
  }
  // No images: the link first.
  ctx.effects.media.push(link);
  if (pdf) {
    ctx.effects.media.push({ kind: "document", url: pdf.url, fileName: pdf.fileName ?? "menu.pdf", caption: tx.menuCaption });
    return { ok: true, sent: "menu_pdf", instruction: "Menu sent. Briefly ask what they'd like to order (one line)." };
  }
  const idx = await ctx.menu();
  if (!idx.itemCount) return fail("NO_MENU", "There is no menu to send. Hand off to staff.");
  ctx.effects.media.push({ kind: "text", text: textMenu(idx, tx.textMenuTitle) });
  return { ok: true, sent: "text_menu", instruction: "A text menu was sent. Briefly ask what they'd like to order (one line)." };
}

export async function sendItemPhotoTool(ctx: BotContext, input: z.infer<typeof itemIdSchema>): Promise<ToolResult> {
  const idx = await ctx.menu();
  const item = findItem(idx, input.item_id);
  if (!item) return fail("ITEM_NOT_FOUND", `No item "${input.item_id}". Use search_menu first.`);
  const url = await ctx.store.getItemPhotoUrl(ctx.session.restaurantId, item.id, item.imageUrl).catch(() => null);
  const price = priceLabel(item);
  if (!url) {
    return fail("no_photo", `There is no photo of ${item.name}. Say so and describe it briefly from the description.`, {
      item: item.name,
      description: item.description,
      price,
    });
  }
  ctx.effects.media.push({ kind: "image", url, caption: `${item.name}${price ? ` — ${price}` : ""}` });
  return { ok: true, sent: "photo", item: item.name, price, instruction: "Photo sent. Ask if they'd like to add it (one line)." };
}

export async function getBestsellersTool(ctx: BotContext): Promise<ToolResult> {
  const idx = await ctx.menu();
  const available = menuItems(idx).filter((i) => i.isAvailable);
  const tagged = available.filter((i) => i.tags.includes("bestseller"));
  const since = new Date(ctx.now().getTime() - 30 * 24 * 3600_000).toISOString();
  const counts = await ctx.store.getBestsellerCounts(ctx.session.restaurantId, ctx.session.branchId, since).catch(() => []);
  const sold = counts.map((c) => available.find((i) => i.id === c.itemId)).filter((i): i is BranchMenuItem => !!i);
  const picks: BranchMenuItem[] = [];
  for (const i of [...tagged, ...sold]) if (!picks.includes(i) && picks.length < 5) picks.push(i);
  if (!picks.length) return fail("NONE", "No bestsellers yet. Suggest using the menu instead (send_menu).");
  return {
    ok: true,
    bestsellers: picks.map((i) => ({ item_id: idx.itemRef.get(i.id), name: i.name, price: priceLabel(i), ...(i.description ? { description: i.description } : {}) })),
    instruction: "Recommend 2–3 of these with their prices, then ask what they'd like.",
  };
}

/** Offers active right now for this branch whose linked item can be ordered. Shared with the greeting. */
export async function currentOffers(ctx: BotContext): Promise<{ offer: OfferRecord; item: BranchMenuItem; ref: string }[]> {
  const [offers, idx] = await Promise.all([ctx.store.getOffers(ctx.session.restaurantId), ctx.menu()]);
  const out: { offer: OfferRecord; item: BranchMenuItem; ref: string }[] = [];
  for (const offer of offers) {
    if (offer.branchId && offer.branchId !== ctx.session.branchId) continue;
    if (!isOfferActiveAt(offer, ctx.now(), ctx.restaurant.timezone)) continue;
    const item = menuItems(idx).find((i) => i.id === offer.menuItemId);
    if (!item || !item.isAvailable) continue; // archived, hidden or sold out → no offer
    out.push({ offer, item, ref: idx.itemRef.get(item.id)! });
  }
  return out;
}

export async function getOffersTool(ctx: BotContext): Promise<ToolResult> {
  const offers = await currentOffers(ctx);
  if (!offers.length) {
    return { ok: true, offers: [], message: "There are NO offers or deals right now. Say so. Never invent a deal or discount." };
  }
  const urdu = ctx.session.language === "urdu";
  return {
    ok: true,
    offers: offers.map(({ offer, item, ref }) => ({
      title: urdu && offer.titleUr ? offer.titleUr : offer.title,
      ...(offer.description ? { description: offer.description } : {}),
      item_id: ref,
      item_name: item.name,
      price: priceLabel(item),
    })),
    instruction: "Only these offers exist. To order one, use add_to_cart with its item_id.",
  };
}

export async function searchFaqsTool(ctx: BotContext, input: z.infer<typeof faqQuerySchema>): Promise<ToolResult> {
  const faqs = await ctx.store.getFaqs(ctx.session.restaurantId);
  const matches = matchFaqs(faqs, input.query);
  if (!matches.length) {
    return fail("NO_MATCH", "No saved answer for this. Check get_restaurant_info; if that doesn't answer it, say you'll ask staff and hand off.");
  }
  const urdu = ctx.session.language === "urdu";
  return {
    ok: true,
    answers: matches.map((m) => ({ question: m.faq.question, answer: urdu && m.faq.answerUr ? m.faq.answerUr : m.faq.answer })),
    instruction: "Answer ONLY from these answers, in the customer's language. Don't add details.",
  };
}

export async function sendLocationTool(ctx: BotContext): Promise<ToolResult> {
  const b = ctx.branch;
  const address = [b.address, b.area].filter(Boolean).join(", ");
  const name = `${ctx.restaurant.name}${b.name ? ` — ${b.name}` : ""}`;
  if (b.latitude != null && b.longitude != null) {
    ctx.effects.media.push({ kind: "location", latitude: b.latitude, longitude: b.longitude, name, address: address || name });
    return { ok: true, sent: "location_pin", address: address || null, instruction: "Location sent. Keep the reply to one short line." };
  }
  if (!address) return fail("NO_LOCATION", "No address saved for this branch. Say you'll ask staff and hand off.");
  ctx.effects.media.push({ kind: "text", text: `📍 ${name}\n${address}${b.mapsUrl ? `\n${b.mapsUrl}` : ""}` });
  return { ok: true, sent: "address_text", address, instruction: "Address sent. Keep the reply to one short line." };
}

/** Maps link for the playground/staff (and the bot's info answer). */
export function branchMapsLink(ctx: BotContext): string | null {
  const b = ctx.branch;
  return b.mapsUrl ?? (b.latitude != null && b.longitude != null ? mapsLinkFor(b.latitude, b.longitude) : null);
}
