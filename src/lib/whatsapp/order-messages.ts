import { formatPhone } from "@/lib/orders/phone";
import type { OrderStatus } from "@/lib/orders/constants";

/**
 * The customer messages for order status changes (Roman Urdu + English).
 * Pure (no server code): also used by the settings page to show examples.
 */

/** Statuses that can send a message (each can be switched off per restaurant). */
export const STATUS_MESSAGE_KEYS = ["accepted", "preparing", "ready", "out_for_delivery", "delivered", "cancelled"] as const;
export type StatusMessageKey = (typeof STATUS_MESSAGE_KEYS)[number];

export const STATUS_MESSAGE_LABELS: Record<StatusMessageKey, string> = {
  accepted: "Order confirmed",
  preparing: "Being prepared",
  ready: "Ready for pickup",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Customer-friendly reasons. Internal ones ("Fake order") are never shown to the customer. */
const CANCEL_REASON_TEXT: Record<string, string> = {
  customer_cancelled: "aap ki request par / you asked to cancel",
  customer_not_responding: "aap se raabta nahi ho saka / we could not reach you",
  out_of_stock: "item available nahi hai / an item is out of stock",
  restaurant_closed: "restaurant band hai ya bohat busy hai / the restaurant is closed or too busy",
};
const CANCEL_REASON_FALLBACK = "restaurant ne cancel kiya / cancelled by the restaurant";

export function cancelReasonText(reason: string | null | undefined): string {
  return (reason && CANCEL_REASON_TEXT[reason]) || CANCEL_REASON_FALLBACK;
}

export type StatusMessageInput = {
  status: OrderStatus;
  orderNumber: number;
  orderType: "delivery" | "pickup" | "dine_in";
  /** Minutes until ready (accepted message). */
  minutes?: number | null;
  cancelReason?: string | null;
  /** Out for delivery: who is bringing it (phone only if the restaurant shares it). */
  rider?: { name: string; phone: string | null } | null;
};

/** The text for a status, or null when this status has no customer message. */
export function orderStatusMessage(input: StatusMessageInput): string | null {
  const n = `#${input.orderNumber}`;
  switch (input.status) {
    case "accepted": {
      const eta = input.minutes && input.minutes > 0 ? ` Tayyar hone mein ~${input.minutes} min.` : "";
      const etaEn = input.minutes && input.minutes > 0 ? ` Ready in about ${input.minutes} min.` : "";
      return `✅ Order ${n} confirm ho gaya!${eta}\nYour order is confirmed.${etaEn}`;
    }
    case "preparing":
      return `👨‍🍳 Order ${n} tayyar ho raha hai.\nYour order is being prepared.`;
    case "ready":
      // Only pickup customers need to come; delivery orders get "on the way" next.
      if (input.orderType !== "pickup") return null;
      return `🛍️ Order ${n} ready hai, aa kar le jayein.\nYour order is ready for pickup.`;
    case "out_for_delivery": {
      if (!input.rider) return `🛵 Order ${n} raaste mein hai.\nYour order is on the way.`;
      const phone = input.rider.phone ? ` (${formatPhone(input.rider.phone)})` : "";
      return `🛵 Order ${n} raaste mein hai. Rider: ${input.rider.name}${phone}.\nYour order is on the way with ${input.rider.name}.`;
    }
    case "delivered":
      return `🎉 Order ${n} deliver ho gaya. Shukriya!\nYour order was delivered. Thank you!`;
    case "cancelled":
      return `❌ Order ${n} cancel ho gaya. Wajah: ${cancelReasonText(input.cancelReason)}.\nYour order was cancelled.`;
    default:
      return null;
  }
}

/** Settings default to ON (also for keys missing from the saved JSON). */
export function isStatusMessageOn(settings: Record<string, unknown>, status: StatusMessageKey): boolean {
  return settings[status] !== false;
}
