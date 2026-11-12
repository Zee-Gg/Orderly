import { z } from "zod";

/**
 * Riders (Phase 9) — pure helpers shared by server actions, queries and tests.
 * No DB, no Next.js.
 */

export const RIDER_EMAIL_DOMAIN = "riders.internal";
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;

/** The hidden login email for a rider (+923001234567 → rider-923001234567@riders.internal). */
export function riderEmail(e164Phone: string): string {
  return `rider-${e164Phone.replace(/\D/g, "")}@${RIDER_EMAIL_DOMAIN}`;
}

export const pinSchema = z.string().regex(/^\d{6}$/, "PIN must be 6 digits");

/** Is this login still locked (5 wrong PINs → 15 minutes)? */
export function lockedFor(lockedUntil: string | null | undefined, now: Date = new Date()): number {
  if (!lockedUntil) return 0;
  const ms = Date.parse(lockedUntil) - now.getTime();
  return ms > 0 ? Math.ceil(ms / 60_000) : 0;
}

export type CashOrder = {
  status: string;
  total: number;
  paymentStatus: string;
  codCollectedAmount: number | null;
  codCollectedAt: string | null;
  settlementId: string | null;
  deliveredAt: string | null;
};

/** Cash the rider must collect at the door (0 when already paid). */
export function cashToCollect(o: Pick<CashOrder, "total" | "paymentStatus">): number {
  return o.paymentStatus === "paid" ? 0 : o.total;
}

/** Cash collected but not yet handed to the restaurant. */
export function cashInHand(orders: CashOrder[]): number {
  return orders.reduce((sum, o) => (o.codCollectedAt && !o.settlementId ? sum + (o.codCollectedAmount ?? 0) : sum), 0);
}

/** Orders delivered since `since` (start of the restaurant's day). */
export function deliveredSince(orders: Pick<CashOrder, "deliveredAt">[], since: Date): number {
  return orders.filter((o) => o.deliveredAt && Date.parse(o.deliveredAt) >= since.getTime()).length;
}

/** "Open in Maps": exact pin when we have one, otherwise a search for the address. */
export function mapsLink(o: { latitude: number | null; longitude: number | null; addressText: string | null; area: string | null; landmark: string | null }): string | null {
  if (o.latitude != null && o.longitude != null) return `https://www.google.com/maps/search/?api=1&query=${o.latitude},${o.longitude}`;
  const q = [o.addressText, o.landmark, o.area].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

export const RIDER_FAIL_REASONS = [
  { value: "customer_not_reachable", label: "Customer not answering", urdu: "کسٹمر فون نہیں اٹھا رہا" },
  { value: "customer_refused", label: "Customer refused", urdu: "کسٹمر نے انکار کر دیا" },
  { value: "wrong_address", label: "Wrong address", urdu: "غلط پتہ" },
  { value: "other", label: "Other", urdu: "کچھ اور" },
] as const;
