import { z } from "zod";
import type { BranchMenuItem, PricingError } from "@/lib/menu/pricing";
import { cartSubtotal, describeLine, invalidateSummary, missingFields, nextLineId, repriceCart, sameChoices, toCartLine } from "../cart";
import { describeItem, findItem, findOption, findSize, matchRemovals, money, type MenuIndex } from "../menu-index";
import { searchMenu } from "../search";
import { fail, type BotContext, type ToolResult } from "./context";

// Models sometimes send null for "not given": accept it everywhere.
const optStr = (max: number) => z.string().trim().max(max).nullish();
const strList = z.array(z.string().trim().min(1).max(60)).max(20).nullish();

// ---------------------------------------------------------------------------
// search_menu
// ---------------------------------------------------------------------------

export const searchMenuSchema = z.object({
  query: z.string().trim().min(1).max(100).describe("What the customer asked for, e.g. 'zinger', 'piza', 'cold drink', 'بریانی'"),
});

export async function searchMenuTool(ctx: BotContext, input: z.infer<typeof searchMenuSchema>): Promise<ToolResult> {
  const idx = await ctx.menu();
  const hits = searchMenu(idx.menu, input.query, 5);
  if (!hits.length) {
    return fail("NOT_FOUND", `Nothing on the menu matches "${input.query}". Tell the customer it's not on our menu; offer similar items only if they exist.`);
  }
  return { ok: true, matches: hits.map((h) => describeItem(idx, h.item, h.category)) };
}

// ---------------------------------------------------------------------------
// add_to_cart / update_cart_line
// ---------------------------------------------------------------------------

export const addToCartSchema = z.object({
  item_id: z.string().trim().min(1).max(60).describe("Item ref from the menu or search_menu, e.g. 'I3'"),
  variant_id: optStr(60).describe("Size ref ('S2') or size name ('Large'). Required when the item has sizes."),
  option_ids: strList.describe("Extras/choices: refs ('O5') or names ('Extra Cheese')"),
  removals: strList.describe("Things to leave out, from the item's 'can remove' list, e.g. ['Onion']"),
  quantity: z.number().int().min(1).max(99).default(1),
  notes: optStr(300).describe("Special requests for the kitchen, incl. allergies (staff will check)"),
});

export const updateLineSchema = z.object({
  line_id: z.string().trim().min(1).max(10).describe("Cart line id, e.g. 'L2'"),
  quantity: z.number().int().min(0).max(99).nullish().describe("New quantity (0 removes the line)"),
  variant_id: optStr(60),
  option_ids: strList.describe("Replaces ALL extras/choices of this line"),
  removals: strList.describe("Replaces ALL removals of this line"),
  notes: optStr(300),
});

export const lineIdSchema = z.object({ line_id: z.string().trim().min(1).max(10) });
export const emptySchema = z.object({});

/** Pricing errors → codes + the valid choices (with refs) so the AI can ask. */
function pricingFailure(idx: MenuIndex, item: BranchMenuItem, errors: PricingError[]): ToolResult {
  const first = errors[0];
  const extra: Record<string, unknown> = { all_errors: errors.map((e) => ({ code: e.code, message: e.message })) };
  if (errors.some((e) => e.code === "SIZE_REQUIRED" || e.code === "INVALID_SIZE")) {
    extra.sizes = item.sizes.map((s) => ({ size_id: idx.sizeRef.get(s.id), name: s.name, price: money(s.price) }));
  }
  const groupErrors = errors.filter((e) => e.groupId);
  if (groupErrors.length) {
    extra.choices = item.groups
      .filter((g) => groupErrors.some((e) => e.groupId === g.id))
      .map((g) => ({
        group: g.name,
        min: g.minSelect,
        max: g.maxSelect,
        options: g.options.filter((o) => o.isAvailable).map((o) => ({ option_id: idx.optionRef.get(o.id), name: o.name, extra_price: o.priceDelta ? money(o.priceDelta) : "free" })),
      }));
  }
  if (errors.some((e) => e.code === "INVALID_REMOVAL")) extra.can_remove = item.removableOptions;
  if (first.code === "ITEM_OUT_OF_STOCK") {
    extra.hint = "Say it's sold out today and offer a similar available item (search_menu).";
  }
  return fail(first.code, first.message, { item: item.name, ...extra });
}

function branchClosed(ctx: BotContext): ToolResult | null {
  if (ctx.branch.isOpenNow) return null;
  return fail("BRANCH_CLOSED", "The restaurant is closed right now. Do not take the order.", { today_hours: ctx.branch.todayHours });
}

export async function addToCartTool(ctx: BotContext, input: z.infer<typeof addToCartSchema>): Promise<ToolResult> {
  const closed = branchClosed(ctx);
  if (closed) return closed;
  const idx = await ctx.menu();
  const item = findItem(idx, input.item_id);
  if (!item) return fail("ITEM_NOT_FOUND", `No item "${input.item_id}". Use search_menu to find the right item_id.`);

  let variantId: string | null = null;
  if (input.variant_id) {
    variantId = findSize(idx, item, input.variant_id);
    if (!variantId) {
      return fail("INVALID_SIZE", `${item.name} has no size "${input.variant_id}".`, {
        sizes: item.sizes.map((s) => ({ size_id: idx.sizeRef.get(s.id), name: s.name, price: money(s.price) })),
      });
    }
  }
  const optionIds = (input.option_ids ?? []).map((o) => findOption(idx, item, o));
  const removals = matchRemovals(item, input.removals ?? []);
  const notes = input.notes?.trim() ?? "";

  const price = (quantity: number, modifierOptionIds: string[]) =>
    ctx.store.priceLine({
      restaurantId: ctx.session.restaurantId,
      branchId: ctx.session.branchId,
      itemId: item.id,
      variantId,
      modifierOptionIds,
      removals,
      quantity,
    });

  let priced = await price(input.quantity, optionIds);
  if (!priced.ok) return pricingFailure(idx, item, priced.errors);
  const choice = { itemId: item.id, variantId, optionIds: priced.line.options.map((o) => o.id), removals: priced.line.removals, notes };

  // Same item with exactly the same choices already in the cart → one line, more quantity.
  const existing = ctx.session.cart.find((l) => sameChoices(l, choice));
  if (existing) {
    priced = await price(existing.quantity + input.quantity, choice.optionIds);
    if (!priced.ok) return pricingFailure(idx, item, priced.errors);
  }

  const line = toCartLine(existing?.lineId ?? nextLineId(ctx.session.cart), { ...choice, quantity: priced.line.quantity }, priced.line);
  ctx.session.cart = existing ? ctx.session.cart.map((l) => (l.lineId === existing.lineId ? line : l)) : [...ctx.session.cart, line];
  ctx.session.failedAttempts = 0;
  invalidateSummary(ctx.session);

  // Defaults the engine picked for required choices (e.g. Spice level: Medium) — tell the customer.
  const requested = new Set(optionIds);
  const defaults = existing ? [] : priced.line.options.filter((o) => !requested.has(o.id)).map((o) => `${o.groupName}: ${o.name}`);
  return {
    ok: true,
    ...(existing ? { merged_into_existing_line: true } : {}),
    line: describeLine(line),
    ...(defaults.length ? { default_choices_applied: defaults } : {}),
    cart_subtotal: money(cartSubtotal(ctx.session.cart)),
    cart_lines: ctx.session.cart.length,
  };
}

export async function updateCartLineTool(ctx: BotContext, input: z.infer<typeof updateLineSchema>): Promise<ToolResult> {
  const line = ctx.session.cart.find((l) => l.lineId.toUpperCase() === input.line_id.toUpperCase());
  if (!line) return fail("LINE_NOT_FOUND", `No cart line ${input.line_id}. Use view_cart to see line ids.`);
  if (input.quantity === 0) return removeCartLineTool(ctx, { line_id: line.lineId });

  const idx = await ctx.menu();
  const item = findItem(idx, line.itemId);
  if (!item) return fail("ITEM_NOT_FOUND", `${line.name} is no longer on the menu. Remove this line.`);

  let variantId = line.variantId;
  if (input.variant_id) {
    variantId = findSize(idx, item, input.variant_id);
    if (!variantId) {
      return fail("INVALID_SIZE", `${item.name} has no size "${input.variant_id}".`, {
        sizes: item.sizes.map((s) => ({ size_id: idx.sizeRef.get(s.id), name: s.name, price: money(s.price) })),
      });
    }
  }
  const optionIds = input.option_ids ? input.option_ids.map((o) => findOption(idx, item, o)) : line.optionIds;
  const removals = input.removals ? matchRemovals(item, input.removals) : line.removals;
  const notes = input.notes != null ? input.notes.trim() : line.notes;
  const quantity = input.quantity ?? line.quantity;

  const priced = await ctx.store.priceLine({
    restaurantId: ctx.session.restaurantId,
    branchId: ctx.session.branchId,
    itemId: line.itemId,
    variantId,
    modifierOptionIds: optionIds,
    removals,
    quantity,
  });
  if (!priced.ok) return pricingFailure(idx, item, priced.errors);

  const updated = toCartLine(line.lineId, { itemId: line.itemId, variantId, optionIds, removals, quantity, notes }, priced.line);
  ctx.session.cart = ctx.session.cart.map((l) => (l.lineId === line.lineId ? updated : l));
  invalidateSummary(ctx.session);
  return { ok: true, line: describeLine(updated), cart_subtotal: money(cartSubtotal(ctx.session.cart)) };
}

export async function removeCartLineTool(ctx: BotContext, input: z.infer<typeof lineIdSchema>): Promise<ToolResult> {
  const line = ctx.session.cart.find((l) => l.lineId.toUpperCase() === input.line_id.toUpperCase());
  if (!line) return fail("LINE_NOT_FOUND", `No cart line ${input.line_id}. Use view_cart to see line ids.`);
  ctx.session.cart = ctx.session.cart.filter((l) => l !== line);
  invalidateSummary(ctx.session);
  return {
    ok: true,
    removed: `${line.quantity}× ${line.name}`,
    cart: ctx.session.cart.map(describeLine),
    cart_subtotal: money(cartSubtotal(ctx.session.cart)),
  };
}

export async function viewCartTool(ctx: BotContext): Promise<ToolResult> {
  const problems = await repriceCart(ctx.store, ctx.session);
  return {
    ok: true,
    lines: ctx.session.cart.map(describeLine),
    subtotal: money(cartSubtotal(ctx.session.cart)),
    ...(problems.length
      ? { problems: problems.map((p) => ({ line_id: p.lineId, item: p.name, error: p.errors[0]?.code, message: p.errors[0]?.message })) }
      : {}),
    still_needed: missingFields(ctx.session, ctx.customer),
  };
}
