import { can, type Role } from "@/lib/auth/permissions";
import type { OrderStatus, OrderType } from "./constants";

/**
 * Order state machine. Mirrored in Postgres (private.order_transition_allowed
 * + role checks in transition_order_status) — keep both in sync.
 *
 *   pending_confirmation → awaiting_acceptance | cancelled
 *   awaiting_acceptance  → accepted | cancelled
 *   accepted             → preparing | cancelled
 *   preparing            → ready | cancelled (manager+)
 *   ready                → out_for_delivery (delivery) | completed (pickup, dine-in) | cancelled (manager+)
 *   out_for_delivery     → delivered | failed
 *   delivered            → completed
 */
export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_confirmation: ["awaiting_acceptance", "cancelled"],
  awaiting_acceptance: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["out_for_delivery", "completed", "cancelled"],
  out_for_delivery: ["delivered", "failed"],
  delivered: ["completed"],
  completed: [],
  cancelled: [],
  failed: [],
};

export type TransitionCheck =
  | { ok: true }
  | { ok: false; code: "INVALID_TRANSITION" | "ROLE_NOT_ALLOWED" | "ON_HOLD"; message: string };

export function isAllowedStep(from: OrderStatus, to: OrderStatus, type: OrderType): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  if (from === "ready" && to === "out_for_delivery") return type === "delivery";
  if (from === "ready" && to === "completed") return type === "pickup" || type === "dine_in";
  return true;
}

/** Can `role` move an order from `from` to `to`? (One step.) */
export function canTransition(args: {
  from: OrderStatus;
  to: OrderStatus;
  orderType: OrderType;
  role: Role | null;
  isOnHold?: boolean;
}): TransitionCheck {
  const { from, to, orderType, role } = args;
  if (!isAllowedStep(from, to, orderType)) {
    return { ok: false, code: "INVALID_TRANSITION", message: "This order can't move to that step." };
  }
  if (args.isOnHold && to !== "cancelled") {
    return { ok: false, code: "ON_HOLD", message: "This order is on hold. Release it first." };
  }
  if (!role || !can(role, "orders.update_status")) {
    return { ok: false, code: "ROLE_NOT_ALLOWED", message: "You can't change this order." };
  }
  if (role === "kitchen") {
    const kitchenOk = (from === "accepted" && to === "preparing") || (from === "preparing" && to === "ready");
    if (!kitchenOk) return { ok: false, code: "ROLE_NOT_ALLOWED", message: "The kitchen can only start and finish cooking." };
  }
  if (to === "cancelled") {
    const late = from === "preparing" || from === "ready";
    if (!can(role, late ? "orders.cancel_late" : "orders.cancel")) {
      return {
        ok: false,
        code: "ROLE_NOT_ALLOWED",
        message: late ? "Only a manager can cancel an order that's already being made." : "You can't cancel orders.",
      };
    }
  }
  return { ok: true };
}

/** Check a whole path, e.g. ["accepted", "preparing"] for "Accept & start". */
export function canTransitionPath(args: {
  from: OrderStatus;
  path: OrderStatus[];
  orderType: OrderType;
  role: Role | null;
  isOnHold?: boolean;
}): TransitionCheck {
  if (args.path.length === 0) return { ok: false, code: "INVALID_TRANSITION", message: "Nothing to change." };
  let from = args.from;
  for (const to of args.path) {
    const check = canTransition({ ...args, from, to });
    if (!check.ok) return check;
    from = to;
  }
  return { ok: true };
}

export type EditCheck = { ok: true; kitchenAlert: boolean } | { ok: false; message: string };

/** Edits: New/Accepted by front of house; Preparing by manager+ (kitchen gets alerted). */
export function canEdit(status: OrderStatus, role: Role | null): EditCheck {
  if (!role || !can(role, "orders.edit")) return { ok: false, message: "You can't edit orders." };
  if (status === "awaiting_acceptance" || status === "accepted") return { ok: true, kitchenAlert: false };
  if (status === "preparing") {
    return can(role, "orders.edit_preparing")
      ? { ok: true, kitchenAlert: true }
      : { ok: false, message: "This order is being prepared. Ask a manager to change it." };
  }
  return { ok: false, message: "This order can't be changed anymore." };
}

export const CANCEL_REASONS = [
  { value: "customer_cancelled", label: "Customer cancelled" },
  { value: "fake_order", label: "Fake order" },
  { value: "customer_not_responding", label: "Customer not responding" },
  { value: "out_of_stock", label: "Item out of stock" },
  { value: "restaurant_closed", label: "Restaurant closed / too busy" },
  { value: "other", label: "Other" },
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number]["value"];

export const FAIL_REASONS = [
  { value: "customer_refused", label: "Customer refused the order" },
  { value: "customer_not_reachable", label: "Customer not reachable" },
  { value: "wrong_address", label: "Wrong address" },
  { value: "other", label: "Other" },
] as const;
export type FailReason = (typeof FAIL_REASONS)[number]["value"];

export function reasonLabel(reason: string | null | undefined) {
  if (!reason) return "";
  return [...CANCEL_REASONS, ...FAIL_REASONS].find((r) => r.value === reason)?.label ?? reason;
}

/** "Other" needs a written note. */
export function reasonNeedsNote(reason: string) {
  return reason === "other";
}

export type NextAction = {
  key: string;
  label: string;
  path: OrderStatus[];
  variant: "primary" | "secondary";
};

/** Forward buttons for an order, in the order they should appear. Cancel is separate. */
export function nextActions(order: { status: OrderStatus; orderType: OrderType; isOnHold: boolean }, role: Role | null): NextAction[] {
  const options: NextAction[] = [];
  const add = (key: string, label: string, path: OrderStatus[], variant: NextAction["variant"] = "primary") => {
    if (canTransitionPath({ from: order.status, path, orderType: order.orderType, role, isOnHold: order.isOnHold }).ok) {
      options.push({ key, label, path, variant });
    }
  };
  switch (order.status) {
    case "pending_confirmation":
      add("confirm", "Mark confirmed", ["awaiting_acceptance"]);
      break;
    case "awaiting_acceptance":
      add("accept", "Accept", ["accepted"]);
      add("accept_start", "Accept & start", ["accepted", "preparing"], "secondary");
      break;
    case "accepted":
      add("start", "Start preparing", ["preparing"]);
      break;
    case "preparing":
      add("ready", "Mark ready", ["ready"]);
      break;
    case "ready":
      add("dispatch", "Out for delivery", ["out_for_delivery"]);
      add("complete", "Picked up · Complete", ["completed"]);
      break;
    case "out_for_delivery":
      add("delivered", "Mark delivered", ["delivered"]);
      break;
    case "delivered":
      add("complete", "Complete", ["completed"]);
      break;
  }
  return options;
}

/** Kanban columns (finished orders leave the board). */
export const BOARD_COLUMNS = [
  { key: "new", label: "New", statuses: ["awaiting_acceptance"] as OrderStatus[] },
  { key: "preparing", label: "Preparing", statuses: ["accepted", "preparing"] as OrderStatus[] },
  { key: "ready", label: "Ready", statuses: ["ready"] as OrderStatus[] },
  { key: "out", label: "Out for delivery", statuses: ["out_for_delivery"] as OrderStatus[] },
] as const;

export const BOARD_STATUSES: OrderStatus[] = BOARD_COLUMNS.flatMap((c) => c.statuses);

/** Status filter chips for the list view. */
export const STATUS_FILTERS = [
  { key: "all", label: "All", statuses: undefined },
  {
    key: "active",
    label: "Active",
    statuses: ["pending_confirmation", "awaiting_acceptance", "accepted", "preparing", "ready", "out_for_delivery"] as OrderStatus[],
  },
  { key: "completed", label: "Completed", statuses: ["delivered", "completed"] as OrderStatus[] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled", "failed"] as OrderStatus[] },
] as const;
export type StatusFilterKey = (typeof STATUS_FILTERS)[number]["key"];
