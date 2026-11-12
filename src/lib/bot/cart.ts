import { createHash } from "node:crypto";
import type { PricingError, ResolvedCartItem } from "@/lib/menu/pricing";
import { deliveryTerms } from "./delivery";
import { money } from "./menu-index";
import { t } from "./texts";
import type { BotLanguage, BotSession, BotStage, BotStore, BranchInfo, CartLine, CustomerInfo } from "./types";

/**
 * Cart helpers. Every price here comes from the pricing engine
 * (store.priceLine → resolveCartItem); this file only copies and adds up
 * engine results. No Next.js imports.
 */

export function nextLineId(cart: CartLine[]): string {
  const max = cart.reduce((m, l) => Math.max(m, Number(l.lineId.replace(/\D/g, "")) || 0), 0);
  return `L${max + 1}`;
}

export function toCartLine(
  lineId: string,
  choice: { itemId: string; variantId: string | null; optionIds: string[]; removals: string[]; quantity: number; notes: string },
  r: ResolvedCartItem,
): CartLine {
  return {
    lineId,
    itemId: choice.itemId,
    variantId: r.variantId,
    // Store what the engine actually applied (includes defaults it picked).
    optionIds: r.options.map((o) => o.id),
    removals: r.removals,
    quantity: r.quantity,
    notes: choice.notes,
    name: r.itemName,
    nameUr: r.itemNameUr,
    sizeName: r.sizeName,
    options: r.options.map((o) => ({ name: o.name, nameUr: o.nameUr })),
    unitPrice: r.unitPrice,
    lineTotal: r.lineTotal,
  };
}

const sortedKey = (xs: string[]) => [...xs].sort().join("|");

/** Same item with the same choices → merge quantities instead of a new line. */
export function sameChoices(a: CartLine, b: Pick<CartLine, "itemId" | "variantId" | "optionIds" | "removals" | "notes">) {
  return (
    a.itemId === b.itemId &&
    a.variantId === b.variantId &&
    sortedKey(a.optionIds) === sortedKey(b.optionIds) &&
    sortedKey(a.removals.map((r) => r.toLowerCase())) === sortedKey(b.removals.map((r) => r.toLowerCase())) &&
    a.notes.trim().toLowerCase() === b.notes.trim().toLowerCase()
  );
}

export const cartSubtotal = (cart: CartLine[]) => cart.reduce((s, l) => s + l.lineTotal, 0);

/** Short line for the AI and the playground. */
export function describeLine(l: CartLine) {
  return {
    line_id: l.lineId,
    quantity: l.quantity,
    name: l.name,
    ...(l.sizeName ? { size: l.sizeName } : {}),
    ...(l.options.length ? { extras: l.options.map((o) => o.name) } : {}),
    ...(l.removals.length ? { without: l.removals } : {}),
    ...(l.notes ? { notes: l.notes } : {}),
    line_total: money(l.lineTotal),
  };
}

/**
 * Re-price every line now (prices or stock may have changed since it was
 * added). Updates display fields in place; returns problems per line.
 */
export async function repriceCart(
  store: BotStore,
  session: BotSession,
): Promise<{ lineId: string; name: string; errors: PricingError[] }[]> {
  const problems: { lineId: string; name: string; errors: PricingError[] }[] = [];
  const results = await Promise.all(
    session.cart.map((l) =>
      store.priceLine({
        restaurantId: session.restaurantId,
        branchId: session.branchId,
        itemId: l.itemId,
        variantId: l.variantId,
        modifierOptionIds: l.optionIds,
        removals: l.removals,
        quantity: l.quantity,
      }),
    ),
  );
  session.cart = session.cart.map((l, i) => {
    const r = results[i];
    if (!r.ok) {
      problems.push({ lineId: l.lineId, name: l.name, errors: r.errors });
      return l;
    }
    return toCartLine(l.lineId, l, r.line);
  });
  return problems;
}

// ---------------------------------------------------------------------------
// What's missing → stage
// ---------------------------------------------------------------------------

export type Missing = "cart_empty" | "order_type" | "delivery_address" | "payment_method" | "customer_name";

export function missingFields(session: BotSession, customer: CustomerInfo | null): Missing[] {
  const out: Missing[] = [];
  if (session.cart.length === 0) out.push("cart_empty");
  if (!session.orderType) out.push("order_type");
  if (session.orderType === "delivery" && !hasAddress(session)) out.push("delivery_address");
  if (session.orderType === "delivery" && session.deliveryZone?.status === "out_of_range") out.push("delivery_address");
  if (!session.paymentMethod) out.push("payment_method");
  if (!customer?.name?.trim()) out.push("customer_name");
  return out;
}

export function hasAddress(session: BotSession): boolean {
  const a = session.address;
  const pin = a.latitude != null && a.longitude != null;
  return (!!a.text?.trim() && !!a.landmark?.trim()) || pin;
}

const STAGE_FOR: Record<Missing, BotStage> = {
  cart_empty: "collecting_items",
  order_type: "choosing_order_type",
  delivery_address: "collecting_address",
  payment_method: "choosing_payment",
  customer_name: "collecting_name",
};

/** The stage = the first missing piece (summary shown → awaiting_confirmation). */
export function computeStage(session: BotSession, customer: CustomerInfo | null): BotStage {
  if (session.status === "completed" || session.status === "abandoned") return "done";
  if (session.summaryHash && session.status === "awaiting_confirmation") return "awaiting_confirmation";
  const missing = missingFields(session, customer);
  return missing.length ? STAGE_FOR[missing[0]] : "collecting_items";
}

/** Any change to the order invalidates a shown summary. */
export function invalidateSummary(session: BotSession) {
  session.summaryHash = null;
  if (session.status === "awaiting_confirmation") session.status = "active";
}

// ---------------------------------------------------------------------------
// Summary (built by code, never by the AI)
// ---------------------------------------------------------------------------

export type OrderSummary = {
  lines: ReturnType<typeof describeLine>[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  orderType: "delivery" | "pickup";
  address: string | null;
  paymentMethod: "cod" | "card_on_delivery";
  customerName: string;
  text: string;
};

export function buildSummary(
  session: BotSession,
  branch: BranchInfo,
  customer: CustomerInfo,
  language: BotLanguage = session.language,
): OrderSummary {
  const tx = t(language);
  const deliveryFee = deliveryTerms(session, branch).fee;
  const subtotal = cartSubtotal(session.cart);
  const total = subtotal + deliveryFee;
  const urdu = language === "urdu";

  const itemLines = session.cart.map((l) => {
    const name = urdu && l.nameUr ? l.nameUr : l.name;
    const extras = l.options.map((o) => (urdu && o.nameUr ? o.nameUr : o.name));
    const details = [l.sizeName, ...extras.map((e) => `+ ${e}`), ...l.removals.map(tx.without)].filter(Boolean).join(", ");
    const note = l.notes ? `\n   ${tx.note}: ${l.notes}` : "";
    return `• ${l.quantity}× ${name}${details ? ` (${details})` : ""} — ${money(l.lineTotal)}${note}`;
  });

  const a = session.address;
  const addressText =
    session.orderType === "delivery"
      ? [a.text, a.area, a.landmark ? `${tx.landmark}: ${a.landmark}` : null].filter(Boolean).join(", ") ||
        (a.latitude != null ? tx.locationPin : "")
      : null;

  const rows = [
    tx.summaryTitle,
    ...itemLines,
    "",
    `${tx.subtotal}: ${money(subtotal)}`,
    ...(session.orderType === "delivery" ? [`${tx.deliveryFee}: ${money(deliveryFee)}`] : []),
    `${tx.total}: *${money(total)}*`,
    "",
    `${tx.orderType}: ${session.orderType === "delivery" ? tx.delivery : tx.pickup}`,
    ...(addressText ? [`${tx.address}: ${addressText}${a.latitude != null && a.text ? " 📍" : ""}`] : []),
    `${tx.payment}: ${session.paymentMethod === "card_on_delivery" ? tx.card : tx.cod}`,
    `${tx.name}: ${customer.name ?? ""}`,
    "",
    tx.confirmQuestion,
  ];

  return {
    lines: session.cart.map(describeLine),
    subtotal,
    deliveryFee,
    total,
    orderType: session.orderType ?? "pickup",
    address: addressText,
    paymentMethod: session.paymentMethod ?? "cod",
    customerName: customer.name ?? "",
    text: rows.join("\n"),
  };
}

/**
 * Fingerprint of everything the customer is agreeing to. confirm_order only
 * works if the cart (re-priced now) still gives the same hash.
 */
export function summaryHash(session: BotSession, deliveryFee: number, customerName: string): string {
  const payload = {
    lines: session.cart.map((l) => [l.itemId, l.variantId, [...l.optionIds].sort(), [...l.removals].sort(), l.quantity, l.notes, l.unitPrice]),
    orderType: session.orderType,
    address: session.orderType === "delivery" ? session.address : null,
    payment: session.paymentMethod,
    deliveryFee,
    name: customerName.trim(),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 40);
}
