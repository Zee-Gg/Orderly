import "server-only";
import type { CurrentContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { todayRange } from "@/lib/time";
import { cashInHand, cashToCollect, deliveredSince, mapsLink, type CashOrder } from "./core";

/**
 * Read models for riders (Phase 9). The rider's own page reads its orders
 * with the RIDER's client (RLS: only orders assigned to them, active or
 * delivered today). Cash in hand spans days, so it's summed on the server
 * for this rider only.
 */

const ACTIVE = ["accepted", "preparing", "ready", "out_for_delivery"] as const;

export type RiderOrder = {
  id: string;
  orderNumber: number;
  status: string;
  version: number;
  customerName: string | null;
  customerPhone: string | null;
  addressText: string | null;
  area: string | null;
  landmark: string | null;
  mapsUrl: string | null;
  notes: string | null;
  itemCount: number;
  items: string[];
  total: number;
  /** 0 when already paid. */
  toCollect: number;
  paid: boolean;
  deliveredAt: string | null;
  codCollectedAmount: number | null;
};

export type RiderHome = {
  rider: { id: string; name: string; isOnline: boolean; branchName: string; restaurantName: string };
  active: RiderOrder[];
  doneToday: RiderOrder[];
  deliveriesToday: number;
  cashInHand: number;
};

type OrderRow = {
  id: string;
  order_number: number;
  status: string;
  version: number;
  customer_name: string | null;
  customer_phone: string | null;
  address_text: string | null;
  area: string | null;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  total: number;
  payment_status: string;
  delivered_at: string | null;
  cod_collected_amount: number | null;
  items: { item_name: string; size_name: string | null; quantity: number; is_cancelled: boolean }[];
};

function toRiderOrder(r: OrderRow): RiderOrder {
  const items = r.items.filter((i) => !i.is_cancelled);
  return {
    id: r.id,
    orderNumber: r.order_number,
    status: r.status,
    version: r.version,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    addressText: r.address_text,
    area: r.area,
    landmark: r.landmark,
    mapsUrl: mapsLink({ latitude: r.latitude, longitude: r.longitude, addressText: r.address_text, area: r.area, landmark: r.landmark }),
    notes: r.notes,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    items: items.map((i) => `${i.quantity}× ${i.item_name}${i.size_name ? ` (${i.size_name})` : ""}`),
    total: r.total,
    toCollect: cashToCollect({ total: r.total, paymentStatus: r.payment_status }),
    paid: r.payment_status === "paid",
    deliveredAt: r.delivered_at,
    codCollectedAmount: r.cod_collected_amount,
  };
}

export async function getRiderHome(ctx: CurrentContext): Promise<RiderHome | null> {
  const supabase = await createClient();
  const { data: rider } = await supabase
    .from("rider_profiles")
    .select("id, name, is_online, is_active, branch:branches(name)")
    .eq("user_id", ctx.user.id)
    .eq("restaurant_id", ctx.restaurant.id)
    .maybeSingle();
  if (!rider?.is_active) return null;

  const { start } = todayRange(ctx.restaurant.timezone);
  const [mine, cash] = await Promise.all([
    // RIDER's client: RLS returns only this rider's visible orders.
    supabase
      .from("orders")
      .select(
        "id, order_number, status, version, customer_name, customer_phone, address_text, area, landmark, latitude, longitude, notes, total, payment_status, delivered_at, cod_collected_amount, items:order_items(item_name, size_name, quantity, is_cancelled)",
      )
      .eq("rider_id", rider.id)
      .order("ready_at", { ascending: true, nullsFirst: false }),
    // Cash in hand spans days → server-side, this rider only.
    createAdminClient()
      .from("orders")
      .select("status, total, payment_status, cod_collected_amount, cod_collected_at, settlement_id, delivered_at")
      .eq("restaurant_id", ctx.restaurant.id)
      .eq("rider_id", rider.id)
      .not("cod_collected_at", "is", null)
      .is("settlement_id", null),
  ]);
  if (mine.error) throw mine.error;
  const orders = ((mine.data ?? []) as unknown as OrderRow[]).map(toRiderOrder);
  const cashRows: CashOrder[] = (cash.data ?? []).map((o) => ({
    status: o.status,
    total: o.total,
    paymentStatus: o.payment_status,
    codCollectedAmount: o.cod_collected_amount,
    codCollectedAt: o.cod_collected_at,
    settlementId: o.settlement_id,
    deliveredAt: o.delivered_at,
  }));
  const branch = rider.branch as unknown as { name: string } | null;
  return {
    rider: { id: rider.id, name: rider.name, isOnline: rider.is_online, branchName: branch?.name ?? "", restaurantName: ctx.restaurant.name },
    // Out for delivery first (customer is waiting), then ready to pick up.
    active: orders.filter((o) => o.status === "out_for_delivery" || o.status === "ready").sort((a, b) => (a.status === b.status ? 0 : a.status === "out_for_delivery" ? -1 : 1)),
    doneToday: orders.filter((o) => o.status === "delivered" || o.status === "completed" || o.status === "failed"),
    deliveriesToday: deliveredSince(orders, start),
    cashInHand: cashInHand(cashRows),
  };
}

// ---------------------------------------------------------------------------
// Dashboard / riders page (front of house; RLS: their branches)
// ---------------------------------------------------------------------------

export type RiderSummary = {
  id: string;
  name: string;
  phone: string;
  branchId: string;
  isOnline: boolean;
  isActive: boolean;
  activeDeliveries: number;
  deliveriesToday: number;
  cashInHand: number;
};

export async function getRiders(ctx: CurrentContext, opts: { includeInactive?: boolean } = {}): Promise<RiderSummary[]> {
  const supabase = await createClient();
  const branchIds = ctx.branches.map((b) => b.id);
  let q = supabase
    .from("rider_profiles")
    .select("id, name, phone, branch_id, is_online, is_active")
    .eq("restaurant_id", ctx.restaurant.id)
    .in("branch_id", branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"])
    .order("name");
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data: riders, error } = await q;
  if (error) throw error;
  if (!riders?.length) return [];
  const ids = riders.map((r) => r.id);
  const { start } = todayRange(ctx.restaurant.timezone);
  const { data: orders } = await supabase
    .from("orders")
    .select("rider_id, status, total, payment_status, cod_collected_amount, cod_collected_at, settlement_id, delivered_at")
    .eq("restaurant_id", ctx.restaurant.id)
    .in("rider_id", ids)
    .or(`status.in.(${ACTIVE.join(",")}),and(cod_collected_at.not.is.null,settlement_id.is.null),delivered_at.gte.${start.toISOString()}`);
  return riders.map((r) => {
    const mine = (orders ?? []).filter((o) => o.rider_id === r.id);
    const cash: CashOrder[] = mine.map((o) => ({
      status: o.status,
      total: o.total,
      paymentStatus: o.payment_status,
      codCollectedAmount: o.cod_collected_amount,
      codCollectedAt: o.cod_collected_at,
      settlementId: o.settlement_id,
      deliveredAt: o.delivered_at,
    }));
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      branchId: r.branch_id,
      isOnline: r.is_online,
      isActive: r.is_active,
      activeDeliveries: mine.filter((o) => (ACTIVE as readonly string[]).includes(o.status)).length,
      deliveriesToday: deliveredSince(cash, start),
      cashInHand: cashInHand(cash),
    };
  });
}

export type UnsettledOrder = { id: string; orderNumber: number; amount: number; total: number; deliveredAt: string | null };
export type Settlement = { id: string; amount: number; expectedAmount: number; orderCount: number; notes: string | null; createdAt: string };

/** Cash orders waiting to be handed in + past settlements (owner/manager). */
export async function getRiderCash(ctx: CurrentContext, riderId: string): Promise<{ unsettled: UnsettledOrder[]; history: Settlement[] }> {
  const supabase = await createClient();
  const [orders, history] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, cod_collected_amount, total, delivered_at")
      .eq("restaurant_id", ctx.restaurant.id)
      .eq("rider_id", riderId)
      .not("cod_collected_at", "is", null)
      .is("settlement_id", null)
      .order("delivered_at"),
    supabase
      .from("rider_settlements")
      .select("id, amount, expected_amount, order_ids, notes, created_at")
      .eq("restaurant_id", ctx.restaurant.id)
      .eq("rider_id", riderId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  return {
    unsettled: (orders.data ?? []).map((o) => ({ id: o.id, orderNumber: o.order_number, amount: o.cod_collected_amount ?? 0, total: o.total, deliveredAt: o.delivered_at })),
    history: (history.data ?? []).map((s) => ({ id: s.id, amount: s.amount, expectedAmount: s.expected_amount, orderCount: s.order_ids.length, notes: s.notes, createdAt: s.created_at })),
  };
}
