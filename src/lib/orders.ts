/**
 * Order enums shared by UI and (later) validation/DB code.
 * Keep these in sync with the Postgres enums when the schema is created.
 */
export const ORDER_STATUSES = [
  "awaiting",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SOURCES = ["whatsapp", "phone", "walk_in"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const PAYMENT_KINDS = ["cod", "bank_transfer", "paid", "unpaid"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const ORDER_TYPES = ["delivery", "pickup"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
