import { priceMenuItem, type PricingResult } from "@/lib/menu/pricing";
import type { PageItem } from "@/lib/menu-page/data";

/**
 * The customer's cart on the menu page: CHOICES only. Prices are always
 * re-computed from the menu with the pricing engine (priceMenuItem) for
 * display, and by the server (from the database) when the cart is sent.
 * Kept in localStorage per restaurant so a refresh doesn't lose it.
 */
export type OrderType = "delivery" | "pickup";
export type PageCartLine = {
  key: string;
  itemId: string;
  variantId: string | null;
  optionIds: string[];
  removals: string[];
  quantity: number;
  notes: string;
};
export type PageCart = { branchId: string; orderType: OrderType; lines: PageCartLine[] };

const storageKey = (restaurantId: string) => `orderly_cart:${restaurantId}`;

export function loadCart(restaurantId: string, branchId: string): PageCart {
  const empty: PageCart = { branchId, orderType: "delivery", lines: [] };
  try {
    const raw = localStorage.getItem(storageKey(restaurantId));
    if (!raw) return empty;
    const c = JSON.parse(raw) as Partial<PageCart>;
    const lines = Array.isArray(c.lines) ? c.lines.filter((l) => l && typeof l.itemId === "string" && Number.isInteger(l.quantity)) : [];
    return { branchId, orderType: c.orderType === "pickup" ? "pickup" : "delivery", lines: lines.slice(0, 30) };
  } catch {
    return empty;
  }
}

export function saveCart(restaurantId: string, cart: PageCart) {
  try {
    localStorage.setItem(storageKey(restaurantId), JSON.stringify(cart));
  } catch {
    // Private mode / storage full: the cart just won't survive a refresh.
  }
}

/** Same item with the same choices → one line. */
export function choiceKey(l: Omit<PageCartLine, "key" | "quantity">): string {
  return [l.itemId, l.variantId ?? "", [...l.optionIds].sort().join(","), [...l.removals].map((r) => r.toLowerCase()).sort().join(","), l.notes.trim().toLowerCase()].join("|");
}

/** Add a line, merging with an identical one (max 99 each). */
export function addLine(lines: PageCartLine[], line: Omit<PageCartLine, "key">, replaceKey?: string): PageCartLine[] {
  const key = choiceKey(line);
  const rest = replaceKey ? lines.filter((l) => l.key !== replaceKey) : lines;
  const same = rest.find((l) => l.key === key);
  if (same) return rest.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, l.quantity + line.quantity) } : l));
  // An edited line keeps its place in the cart.
  if (replaceKey) return lines.map((l) => (l.key === replaceKey ? { ...line, key } : l));
  return [...rest, { ...line, key }];
}

/** Price one line from the menu (null = the item isn't on this menu any more). */
export function priceLine(restaurantId: string, branchId: string, item: PageItem | undefined, l: PageCartLine): PricingResult | null {
  if (!item) return null;
  return priceMenuItem(restaurantId, branchId, item, {
    variantId: l.variantId,
    modifierOptionIds: l.optionIds,
    removals: l.removals,
    quantity: l.quantity,
  });
}

// ---------------------------------------------------------------------------
// A tiny store over localStorage (useSyncExternalStore: the server renders an
// empty cart, the browser shows the saved one right after hydration).
// ---------------------------------------------------------------------------
const carts = new Map<string, PageCart>();
const emptyCarts = new Map<string, PageCart>();
const listeners = new Set<() => void>();

function emptyFor(branchId: string): PageCart {
  let e = emptyCarts.get(branchId);
  if (!e) emptyCarts.set(branchId, (e = { branchId, orderType: "delivery", lines: [] }));
  return e;
}

export function getCart(restaurantId: string, branchId: string): PageCart {
  const key = `${restaurantId}:${branchId}`;
  let c = carts.get(key);
  if (!c) carts.set(key, (c = loadCart(restaurantId, branchId)));
  return c;
}

export function updateCart(restaurantId: string, branchId: string, fn: (c: PageCart) => PageCart) {
  const next = fn(getCart(restaurantId, branchId));
  carts.set(`${restaurantId}:${branchId}`, next);
  saveCart(restaurantId, next);
  listeners.forEach((l) => l());
}

export function subscribeCart(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const serverCart = (branchId: string) => emptyFor(branchId);

/** Open a URL (WhatsApp link, other branch) — outside React components. */
export function goTo(url: string | URL) {
  window.location.assign(url);
}

/** Remember the page language for the next visit (read by the server). */
export function rememberLang(lang: string, cookieName: string) {
  document.cookie = `${cookieName}=${lang}; path=/m; max-age=31536000; samesite=lax`;
}
