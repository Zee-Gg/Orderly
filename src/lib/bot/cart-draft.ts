import { findCodesInText, mentionsOrderCode } from "@/lib/menu-page/code";
import { invalidateSummary, nextLineId, sameChoices, toCartLine } from "./cart";
import type { BotLanguage, BotSession, BotStore, CartDraft, CartLine } from "./types";

/**
 * Menu-page carts in the chat (Phase 8). CODE, not AI: finds an order code in
 * the customer's message, re-prices every line with the pricing engine NOW,
 * skips what can't be sold, and puts the rest in the session cart. The bot
 * then continues the normal flow (order type → address → payment → summary).
 * No Next.js imports.
 */

export type CodeCheck =
  | { kind: "none" }
  /** A draft with this code exists for this restaurant (maybe used/expired). */
  | { kind: "draft"; draft: CartDraft }
  /** The customer clearly sent a code, but we don't know it. */
  | { kind: "unknown" };

export async function detectOrderCode(store: BotStore, restaurantId: string, text: string): Promise<CodeCheck> {
  const codes = findCodesInText(text);
  for (const code of codes.slice(0, 3)) {
    const draft = await store.findCartDraft(restaurantId, code);
    if (draft) return { kind: "draft", draft };
  }
  if (mentionsOrderCode(text) && /code\s*[:#-]?\s*[a-z0-9][a-z0-9\s-]{2,8}/i.test(text)) return { kind: "unknown" };
  return { kind: "none" };
}

export function draftUsable(draft: CartDraft, now: Date): boolean {
  return !draft.usedAt && Date.parse(draft.expiresAt) > now.getTime();
}

/** "2x Zinger Burger (Large)" in the customer's language. */
export function lineLabel(l: Pick<CartLine, "quantity" | "name" | "nameUr" | "sizeName">, lang: BotLanguage): string {
  const name = lang === "urdu" && l.nameUr ? l.nameUr : l.name;
  return `${l.quantity}x ${name}${l.sizeName ? ` (${l.sizeName})` : ""}`;
}

/**
 * Put a draft into the session cart. "replace" empties the cart first (and
 * moves the session to the draft's branch when it changed); "add" merges into
 * the current cart (priced at the session's branch). Returns what was loaded
 * and what was skipped (sold out, removed, choices no longer valid).
 */
export async function loadDraftIntoCart(
  store: BotStore,
  session: BotSession,
  draft: CartDraft,
  mode: "replace" | "add",
  itemNames: Map<string, { name: string; nameUr: string | null }>,
): Promise<{ loaded: string[]; skipped: string[] }> {
  const s = session;
  if (mode === "replace") {
    s.cart = [];
    s.branchId = draft.branchId;
  }
  const loaded: string[] = [];
  const skipped: string[] = [];
  for (const l of draft.lines) {
    const choice = { itemId: l.itemId, variantId: l.variantId, optionIds: l.optionIds, removals: l.removals, notes: l.notes };
    const price = (quantity: number, optionIds: string[]) =>
      store.priceLine({
        restaurantId: s.restaurantId,
        branchId: s.branchId,
        itemId: l.itemId,
        variantId: l.variantId,
        modifierOptionIds: optionIds,
        removals: l.removals,
        quantity,
      });
    let priced = await price(l.quantity, l.optionIds);
    if (!priced.ok) {
      const n = itemNames.get(l.itemId);
      skipped.push(`${l.quantity}x ${s.language === "urdu" && n?.nameUr ? n.nameUr : (n?.name ?? "item")}`);
      continue;
    }
    const applied = { ...choice, optionIds: priced.line.options.map((o) => o.id), removals: priced.line.removals };
    const existing = s.cart.find((c) => sameChoices(c, applied));
    if (existing) {
      const merged = await price(existing.quantity + l.quantity, applied.optionIds);
      if (merged.ok) priced = merged;
    }
    const line = toCartLine(existing?.lineId ?? nextLineId(s.cart), { ...applied, quantity: priced.line.quantity }, priced.line);
    s.cart = existing ? s.cart.map((c) => (c.lineId === existing.lineId ? line : c)) : [...s.cart, line];
    loaded.push(lineLabel({ ...line, quantity: l.quantity }, s.language));
  }
  if (draft.orderType && (mode === "replace" || !s.orderType)) s.orderType = draft.orderType;
  s.cartDraftId = draft.id;
  s.pendingCartCode = null;
  s.failedAttempts = 0;
  invalidateSummary(s);
  if (s.status === "awaiting_confirmation") s.status = "active";
  return { loaded, skipped };
}
