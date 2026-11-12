import type { EmittedEvent, EmittedOrder } from "@/lib/orders/events";
import { isStatusMessageOn, orderStatusMessage, STATUS_MESSAGE_KEYS, type StatusMessageKey } from "./order-messages";
import { createSender, OUTSIDE_WINDOW, type SenderDeps } from "./send";

export * from "./order-messages";

/**
 * Order status messages to the customer (Roman Urdu + English).
 * Called from emitOrderEvent (the single order-notification hook), always in
 * the background. No templates: only inside the 24-hour window, otherwise skipped.
 * No Next.js imports.
 */

/** Which status (if any) this order event announces. */
export function announcedStatus(event: EmittedEvent): StatusMessageKey | null {
  const to = event.to;
  if (!to) return null;
  // A new order that starts "accepted" (staff orders) is also a confirmation.
  if (event.kind !== "status_changed" && event.kind !== "cancelled" && !(event.kind === "created" && to === "accepted")) {
    return null;
  }
  return (STATUS_MESSAGE_KEYS as readonly string[]).includes(to) ? (to as StatusMessageKey) : null;
}

export type OrderUpdateResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: string; messageId?: string | null };

/** Customer's WhatsApp id: from their chat if known, else their phone (E.164 without "+"). */
export function customerWaId(ctx: { customerWaId: string | null; customerPhone: string | null }): string | null {
  if (ctx.customerWaId) return ctx.customerWaId;
  const digits = (ctx.customerPhone ?? "").replace(/\D/g, "");
  return ctx.customerPhone?.startsWith("+") && digits.length >= 8 ? digits : null;
}

export async function sendOrderUpdate(
  deps: SenderDeps,
  order: EmittedOrder,
  event: EmittedEvent,
): Promise<OrderUpdateResult> {
  const status = announcedStatus(event);
  if (!status) return { sent: false, reason: "no message for this change" };

  const account = await deps.store.findAccountByRestaurant(order.restaurantId);
  if (!account?.isActive) return { sent: false, reason: "WhatsApp is not connected" };

  const ctx = await deps.store.getOrderMessageContext(order.restaurantId, order.id);
  if (!ctx) return { sent: false, reason: "order not found" };
  if (!isStatusMessageOn(ctx.statusMessages, status)) return { sent: false, reason: `"${status}" message is switched off` };

  const to = customerWaId(ctx);
  if (!to) return { sent: false, reason: "customer has no WhatsApp number" };

  const now = deps.now?.() ?? Date.now();
  const minutes = ctx.expectedReadyAt
    ? Math.max(1, Math.round((Date.parse(ctx.expectedReadyAt) - now) / 60_000))
    : ctx.defaultPrepMinutes;
  const text = orderStatusMessage({
    status,
    orderNumber: ctx.orderNumber,
    orderType: ctx.orderType,
    minutes,
    cancelReason: (event.data?.reason as string | undefined) ?? ctx.cancelReason,
    rider: ctx.rider ?? null,
  });
  if (!text) return { sent: false, reason: "no message for this order type" };

  const result = await createSender(deps).sendText(order.restaurantId, to, text, { orderId: order.id });
  if (result.ok) return { sent: true, messageId: result.messageId };
  // Outside the window (or never messaged): skipped, saved on the chat when there is one.
  return { sent: false, reason: result.status === "skipped" ? `skipped: ${OUTSIDE_WINDOW}` : `failed: ${result.error}`, messageId: result.messageId };
}
