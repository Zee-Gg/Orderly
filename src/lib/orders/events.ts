import type { Actor } from "./engine";
import type { OrderStatus } from "./constants";

export type OrderEventKind =
  | "created"
  | "status_changed"
  | "cancelled"
  | "edited"
  | "held"
  | "unheld"
  | "payment_updated"
  | "rider_assigned"
  | "rider_unassigned"
  | "cash_collected";

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

export type OrderEventHandler = (order: EmittedOrder, event: EmittedEvent) => Promise<void>;
/** Runs a task after the response (Next.js `after()` on the server). */
export type BackgroundRunner = (task: () => Promise<void>) => void;

let handler: OrderEventHandler | null = null;
let runInBackground: BackgroundRunner = (task) => void task();

/**
 * Server code registers the notification handler once (see
 * src/lib/orders/notifications.ts). Scripts and tests that don't register
 * one simply send nothing.
 */
export function setOrderEventHandler(next: OrderEventHandler | null, runner?: BackgroundRunner) {
  handler = next;
  if (runner) runInBackground = runner;
}

/**
 * THE single hook called after every order change (create, status, edit,
 * hold, payment). The change is already committed when this runs.
 *
 * WhatsApp customer messages (Phase 6B) plug in HERE, and nowhere else.
 * Non-blocking: returns at once, the handler runs in the background, and
 * nothing it does can throw into (or slow down) the staff action.
 */
export async function emitOrderEvent(order: EmittedOrder, event: EmittedEvent): Promise<void> {
  const current = handler;
  if (!current) return;
  const task = async () => {
    try {
      await current(order, event);
    } catch (err) {
      console.error("[orders] event handler failed", order.id, event.kind, err instanceof Error ? err.message : err);
    }
  };
  try {
    runInBackground(task);
  } catch (err) {
    console.error("[orders] could not schedule event handler", err instanceof Error ? err.message : err);
  }
}
