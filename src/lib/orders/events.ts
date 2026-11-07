import type { Actor } from "./engine";
import type { OrderStatus } from "./constants";

export type OrderEventKind = "created" | "status_changed" | "cancelled" | "edited" | "held" | "unheld" | "payment_updated";

export type EmittedOrder = {
  id: string;
  restaurantId: string;
  branchId: string;
  orderNumber?: number;
};

export type EmittedEvent = {
  kind: OrderEventKind;
  from?: OrderStatus;
  to?: OrderStatus;
  actor: Actor;
  data?: Record<string, unknown>;
};

/**
 * THE single hook called after every order change (create, status, edit,
 * hold, payment). The change is already committed when this runs.
 *
 * Phase 6 plugs WhatsApp customer notifications in HERE ("Your order is
 * ready!"), and nowhere else. Keep it non-blocking: never throw, and never
 * make the staff action wait on a slow external call (queue it instead).
 */
export async function emitOrderEvent(order: EmittedOrder, event: EmittedEvent): Promise<void> {
  void order;
  void event;
}
