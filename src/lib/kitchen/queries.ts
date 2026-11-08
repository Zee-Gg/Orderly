import "server-only";
import type { CurrentContext } from "@/lib/auth/session";
import type { OrderStatus, OrderType } from "@/lib/orders/constants";
import { createClient } from "@/lib/supabase/server";
import { READY_VISIBLE_MS } from "./constants";

/**
 * Kitchen read model. Uses ONLY the `kitchen_orders` view (no phone,
 * address or money) plus order items and events — kitchen users can't read
 * the orders table at all (RLS).
 */

export type KitchenItem = {
  id: string;
  quantity: number;
  name: string;
  size: string | null;
  extras: string[];
  removals: string[];
  notes: string | null;
};

export type KitchenTicket = {
  id: string;
  orderNumber: number;
  branchId: string;
  status: OrderStatus;
  orderType: OrderType;
  tableNumber: string | null;
  notes: string | null;
  isOnHold: boolean;
  holdReason: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  cancelledAt: string | null;
  version: number;
  items: KitchenItem[];
  /** Latest edit made after the kitchen got the ticket (for the CHANGED badge). */
  lastEdit: { id: number; at: string } | null;
};

export type KitchenSnapshot = {
  tickets: KitchenTicket[];
  newCount: number;
  branches: Record<string, { name: string; lateOrderMinutes: number }>;
  fetchedAt: string;
};

/** Cancelled tickets the kitchen had seen raise a banner for this long. */
const CANCELLED_WINDOW_MS = 3 * 60 * 60_000;

export function kitchenBranchIds(ctx: CurrentContext) {
  return ctx.currentBranch ? [ctx.currentBranch.id] : ctx.branches.map((b) => b.id);
}

export async function getKitchenSnapshot(ctx: CurrentContext): Promise<KitchenSnapshot> {
  const supabase = await createClient();
  const branchIds = kitchenBranchIds(ctx);
  const now = Date.now();
  const readySince = new Date(now - READY_VISIBLE_MS - 60_000).toISOString();
  const cancelledSince = new Date(now - CANCELLED_WINDOW_MS).toISOString();

  const [orders, waiting, branches] = await Promise.all([
    supabase
      .from("kitchen_orders")
      .select(
        "id, order_number, branch_id, status, order_type, table_number, notes, is_on_hold, hold_reason, accepted_at, ready_at, cancelled_at, version",
      )
      .eq("restaurant_id", ctx.restaurant.id)
      .in("branch_id", branchIds)
      .or(
        `status.in.(accepted,preparing),and(status.eq.ready,ready_at.gte.${readySince}),and(status.eq.cancelled,cancelled_at.gte.${cancelledSince},accepted_at.not.is.null)`,
      )
      .order("accepted_at", { ascending: true })
      .limit(200),
    supabase
      .from("kitchen_orders")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", ctx.restaurant.id)
      .in("branch_id", branchIds)
      .eq("status", "awaiting_acceptance"),
    supabase.from("branches").select("id, name, late_order_minutes").in("id", branchIds),
  ]);
  if (orders.error) throw orders.error;

  const rows = orders.data ?? [];
  const ids = rows.map((r) => r.id as string);
  const [items, edits] = ids.length
    ? await Promise.all([
        supabase
          .from("order_items")
          .select("id, order_id, quantity, item_name, size_name, removals, notes, created_at, modifiers:order_item_modifiers(option_name)")
          .in("order_id", ids)
          .eq("is_cancelled", false)
          .order("created_at"),
        supabase
          .from("order_events")
          .select("id, order_id, created_at")
          .in("order_id", ids)
          .eq("event_type", "edited")
          .order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  const tickets: KitchenTicket[] = rows.map((r) => {
    const edit = (edits.data ?? []).find((e) => e.order_id === r.id);
    return {
      id: r.id!,
      orderNumber: r.order_number!,
      branchId: r.branch_id!,
      status: r.status!,
      orderType: r.order_type!,
      tableNumber: r.table_number,
      notes: r.notes,
      isOnHold: r.is_on_hold ?? false,
      holdReason: r.hold_reason,
      acceptedAt: r.accepted_at,
      readyAt: r.ready_at,
      cancelledAt: r.cancelled_at,
      version: r.version!,
      items: (items.data ?? [])
        .filter((i) => i.order_id === r.id)
        .map((i) => ({
          id: i.id,
          quantity: i.quantity,
          name: i.item_name,
          size: i.size_name,
          extras: i.modifiers.map((m) => m.option_name),
          removals: i.removals,
          notes: i.notes,
        })),
      lastEdit: edit && r.accepted_at && edit.created_at > r.accepted_at ? { id: edit.id, at: edit.created_at } : null,
    };
  });

  return {
    tickets,
    newCount: waiting.count ?? 0,
    branches: Object.fromEntries(
      (branches.data ?? []).map((b) => [b.id, { name: b.name, lateOrderMinutes: b.late_order_minutes }]),
    ),
    fetchedAt: new Date().toISOString(),
  };
}
