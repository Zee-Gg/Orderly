import type { Database } from "@/types/database";

/**
 * Order enums, typed from the database. Keep UI labels here so every screen
 * (and later the WhatsApp bot) uses the same words.
 */
type Enums = Database["public"]["Enums"];

export type OrderStatus = Enums["order_status"];
export type OrderType = Enums["order_type"];
export type OrderSource = Enums["order_source"];
export type PaymentMethod = Enums["payment_method"];
export type PaymentStatus = Enums["payment_status"];

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "pending_confirmation",
  "awaiting_acceptance",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "completed",
  "cancelled",
  "failed",
];

export const ORDER_TYPES: readonly OrderType[] = ["delivery", "pickup", "dine_in"];
export const ORDER_SOURCES: readonly OrderSource[] = ["whatsapp", "phone", "walk_in", "web"];
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["cod", "card_on_delivery", "bank_transfer", "online_link"];
export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "unpaid",
  "pending_verification",
  "paid",
  "refunded",
  "partially_refunded",
];

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  delivery: "Delivery",
  pickup: "Pickup",
  dine_in: "Dine-in",
};

export const SOURCE_LABELS: Record<OrderSource, string> = {
  whatsapp: "WhatsApp",
  phone: "Phone",
  walk_in: "Walk-in",
  web: "Website",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cod: "Cash on delivery",
  card_on_delivery: "Card on delivery",
  bank_transfer: "Bank transfer",
  online_link: "Online payment",
};

/** What the PaymentBadge can show (a method, or a payment state). */
export const PAYMENT_KINDS = [
  "cod",
  "card_on_delivery",
  "bank_transfer",
  "online_link",
  "paid",
  "unpaid",
  "pending_verification",
  "refunded",
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

/** One badge for an order: "Paid" once paid, otherwise how they'll pay. */
export function paymentKindOf(method: PaymentMethod, status: PaymentStatus): PaymentKind {
  if (status === "paid") return "paid";
  if (status === "pending_verification") return "pending_verification";
  if (status === "refunded" || status === "partially_refunded") return "refunded";
  return method;
}

/**
 * SALES = delivered + completed orders. The ONE definition used by /reports
 * (report_* RPCs) and the top bar's "Orders today" / "Sales today".
 * Cancelled and failed orders are never sales.
 */
export const SALE_STATUSES: readonly OrderStatus[] = ["delivered", "completed"];
export function isSaleStatus(status: OrderStatus): boolean {
  return SALE_STATUSES.includes(status);
}

/** Statuses that are finished and leave the live board. */
export const FINISHED_STATUSES: readonly OrderStatus[] = ["delivered", "completed", "cancelled", "failed"];
