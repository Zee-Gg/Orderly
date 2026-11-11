import "server-only";
import type { CurrentContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE, localDateRange, todayRange } from "@/lib/time";
import type { OrderSource, OrderStatus, OrderType, PaymentMethod, PaymentStatus } from "./constants";
import { normalizePhone } from "./phone";
import { BOARD_STATUSES } from "./status";

/**
 * Read models for order screens. Runs as the signed-in user (RLS: front of
 * house with branch access only). Never used to WRITE.
 */

export type BoardOrder = {
  id: string;
  orderNumber: number;
  branchId: string;
  status: OrderStatus;
  orderType: OrderType;
  source: OrderSource;
  customerName: string | null;
  area: string | null;
  tableNumber: string | null;
  itemCount: number;
  itemSummary: string;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  isOnHold: boolean;
  holdReason: string | null;
  /** Fake orders + refused deliveries by this customer before. */
  riskCount: number;
  /** Set by the bot, e.g. "New customer, high value — call to confirm." */
  riskFlag: string | null;
  /** Placed by the AI bot (WhatsApp, no staff member). */
  fromBot: boolean;
  createdAt: string;
  acceptedAt: string | null;
  readyAt: string | null;
  dispatchedAt: string | null;
  version: number;
};

export type BranchOrderSettings = Record<string, { name: string; acceptAlertMinutes: number; lateOrderMinutes: number }>;

export type LiveStats = { ordersToday: number; salesToday: number; pending: number };

/** WhatsApp chats the bot handed to staff (bot switched off for the chat). */
export type NeedsStaffChat = { id: string; name: string | null; phone: string | null; reason: string | null; at: string };

export type LiveSnapshot = {
  orders: BoardOrder[];
  stats: LiveStats;
  needsStaff: NeedsStaffChat[];
  settings: BranchOrderSettings;
  fetchedAt: string;
};

const BOARD_SELECT =
  "id, order_number, branch_id, status, order_type, source, customer_name, area, table_number, total, payment_method, payment_status, is_on_hold, hold_reason, risk_flag, created_by, created_at, accepted_at, ready_at, dispatched_at, version, items:order_items(item_name, size_name, quantity, is_cancelled), customer:customers(cancelled_count, refused_count)";

type BoardRow = {
  id: string;
  order_number: number;
  branch_id: string;
  status: OrderStatus;
  order_type: OrderType;
  source: OrderSource;
  customer_name: string | null;
  area: string | null;
  table_number: string | null;
  total: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  is_on_hold: boolean;
  hold_reason: string | null;
  risk_flag: string | null;
  created_by: string | null;
  created_at: string;
  accepted_at: string | null;
  ready_at: string | null;
  dispatched_at: string | null;
  version: number;
  items: { item_name: string; size_name: string | null; quantity: number; is_cancelled: boolean }[];
  customer: { cancelled_count: number; refused_count: number } | null;
};

function toBoardOrder(r: BoardRow): BoardOrder {
  const items = r.items.filter((i) => !i.is_cancelled);
  return {
    id: r.id,
    orderNumber: r.order_number,
    branchId: r.branch_id,
    status: r.status,
    orderType: r.order_type,
    source: r.source,
    customerName: r.customer_name,
    area: r.area,
    tableNumber: r.table_number,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    itemSummary: items
      .map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.item_name}${i.size_name ? ` (${i.size_name})` : ""}`)
      .join(", "),
    total: r.total,
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    isOnHold: r.is_on_hold,
    holdReason: r.hold_reason,
    riskCount: (r.customer?.cancelled_count ?? 0) + (r.customer?.refused_count ?? 0),
    riskFlag: r.risk_flag,
    fromBot: r.source === "whatsapp" && r.created_by === null,
    createdAt: r.created_at,
    acceptedAt: r.accepted_at,
    readyAt: r.ready_at,
    dispatchedAt: r.dispatched_at,
    version: r.version,
  };
}

/** Branches in view: the selected branch, or every branch the member can access. */
export function scopeBranchIds(ctx: CurrentContext) {
  return ctx.currentBranch ? [ctx.currentBranch.id] : ctx.branches.map((b) => b.id);
}

export async function getLiveSnapshot(ctx: CurrentContext): Promise<LiveSnapshot> {
  const supabase = await createClient();
  const branchIds = scopeBranchIds(ctx);
  const tz = ctx.restaurant.timezone || DEFAULT_TIMEZONE;
  const { start, end } = todayRange(tz);

  const [board, today, branches, chats] = await Promise.all([
    supabase
      .from("orders")
      .select(BOARD_SELECT)
      .eq("restaurant_id", ctx.restaurant.id)
      .in("branch_id", branchIds)
      .in("status", BOARD_STATUSES)
      .order("created_at")
      .limit(300),
    supabase
      .from("orders")
      .select("status, total")
      .eq("restaurant_id", ctx.restaurant.id)
      .in("branch_id", branchIds)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .neq("status", "pending_confirmation")
      .limit(5000),
    supabase
      .from("branches")
      .select("id, name, accept_alert_minutes, late_order_minutes")
      .in("id", branchIds),
    // RLS: front of house only (kitchen gets none).
    supabase
      .from("whatsapp_conversations")
      .select("id, handoff_reason, handed_off_at, wa_id, customer:customers(name, phone)")
      .eq("restaurant_id", ctx.restaurant.id)
      .eq("bot_enabled", false)
      .not("handed_off_at", "is", null)
      .order("handed_off_at", { ascending: false })
      .limit(20),
  ]);
  if (board.error) throw board.error;
  if (today.error) throw today.error;

  const orders = ((board.data ?? []) as unknown as BoardRow[]).map(toBoardOrder);
  const counted = (today.data ?? []).filter((o) => o.status !== "cancelled" && o.status !== "failed");
  return {
    orders,
    needsStaff: (chats.data ?? []).map((c) => ({
      id: c.id,
      name: c.customer?.name ?? null,
      phone: c.customer?.phone ?? `+${c.wa_id}`,
      reason: c.handoff_reason,
      at: c.handed_off_at!,
    })),
    stats: {
      ordersToday: counted.length,
      salesToday: counted.reduce((sum, o) => sum + o.total, 0),
      pending: orders.filter((o) => o.status === "awaiting_acceptance").length,
    },
    settings: Object.fromEntries(
      (branches.data ?? []).map((b) => [
        b.id,
        { name: b.name, acceptAlertMinutes: b.accept_alert_minutes, lateOrderMinutes: b.late_order_minutes },
      ]),
    ),
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

export type OrderFilters = {
  statuses?: OrderStatus[];
  orderType?: OrderType | "";
  source?: OrderSource | "";
  paymentStatus?: PaymentStatus | "";
  /** Local dates, YYYY-MM-DD (restaurant timezone). */
  from?: string;
  to?: string;
  search?: string;
  page?: number;
};

export const PAGE_SIZE = 25;

export async function listOrders(ctx: CurrentContext, filters: OrderFilters) {
  const supabase = await createClient();
  const tz = ctx.restaurant.timezone || DEFAULT_TIMEZONE;
  const today = todayRange(tz).ymd;
  const range = localDateRange(filters.from || today, filters.to || filters.from || today, tz);
  const page = Math.max(1, filters.page ?? 1);

  let query = supabase
    .from("orders")
    .select(BOARD_SELECT, { count: "exact" })
    .eq("restaurant_id", ctx.restaurant.id)
    .in("branch_id", scopeBranchIds(ctx))
    .gte("created_at", range.start.toISOString())
    .lt("created_at", range.end.toISOString())
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (filters.statuses?.length) query = query.in("status", filters.statuses);
  if (filters.orderType) query = query.eq("order_type", filters.orderType);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.paymentStatus) query = query.eq("payment_status", filters.paymentStatus);

  const search = filters.search?.trim().replace(/^#/, "") ?? "";
  if (search) {
    const phone = normalizePhone(search);
    if (/^\d{1,7}$/.test(search)) query = query.eq("order_number", Number(search));
    else if (phone) query = query.eq("customer_phone", phone);
    else query = query.ilike("customer_name", `%${search.replace(/[%_]/g, "")}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    orders: ((data ?? []) as unknown as BoardRow[]).map(toBoardOrder),
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export async function getOrderDetail(ctx: CurrentContext, orderId: string) {
  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "*, branch:branches(name), items:order_items(id, item_id, variant_id, item_name, size_name, quantity, unit_price, line_total, removals, notes, is_cancelled, snapshot, created_at, modifiers:order_item_modifiers(option_id, group_name, option_name, price_delta)), customer:customers(id, name, phone, notes, tags, is_blocked, blocked_reason, total_orders, cancelled_count, refused_count)",
    )
    .eq("id", orderId)
    .eq("restaurant_id", ctx.restaurant.id)
    .maybeSingle();
  if (error) throw error;
  if (!order) return null;

  const [{ data: events }, { data: payments }, { data: chat }] = await Promise.all([
    supabase
      .from("order_events")
      .select("id, event_type, from_status, to_status, actor_type, actor_user_id, data, created_at")
      .eq("order_id", orderId)
      .order("created_at"),
    supabase
      .from("payments")
      .select("id, method, amount, status, reference, verified_by, verified_at, created_at")
      .eq("order_id", orderId)
      .order("created_at"),
    // The WhatsApp chat with this customer (RLS: front of house only).
    order.source === "whatsapp" && order.customer_id
      ? supabase
          .from("whatsapp_conversations")
          .select("id")
          .eq("restaurant_id", ctx.restaurant.id)
          .eq("customer_id", order.customer_id)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const actorIds = [
    ...new Set([...(events ?? []).map((e) => e.actor_user_id), ...(payments ?? []).map((p) => p.verified_by)].filter(Boolean)),
  ] as string[];
  const { data: people } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name ?? "Staff"]));

  return {
    ...order,
    items: [...order.items]
      .filter((i) => !i.is_cancelled)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    events: (events ?? []).map((e) => ({ ...e, actorName: e.actor_user_id ? (names.get(e.actor_user_id) ?? "Staff") : null })),
    payments: (payments ?? []).map((p) => ({ ...p, verifiedByName: p.verified_by ? (names.get(p.verified_by) ?? "Staff") : null })),
    timezone: ctx.restaurant.timezone || DEFAULT_TIMEZONE,
    fromBot: order.source === "whatsapp" && order.created_by === null,
    conversationId: chat?.id ?? null,
  };
}
export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export type CustomerLookup = {
  id: string;
  name: string | null;
  phone: string;
  totalOrders: number;
  riskCount: number;
  cancelledCount: number;
  refusedCount: number;
  isBlocked: boolean;
  blockedReason: string | null;
  tags: string[];
  addresses: { id: string; label: string | null; addressText: string; area: string | null; landmark: string | null; isDefault: boolean }[];
};

export async function lookupCustomer(ctx: CurrentContext, rawPhone: string): Promise<CustomerLookup | null> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select(
      "id, name, phone, total_orders, cancelled_count, refused_count, is_blocked, blocked_reason, tags, addresses:customer_addresses(id, label, address_text, area, landmark, is_default, created_at)",
    )
    .eq("restaurant_id", ctx.restaurant.id)
    .eq("phone", phone)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    phone: data.phone,
    totalOrders: data.total_orders,
    riskCount: data.cancelled_count + data.refused_count,
    cancelledCount: data.cancelled_count,
    refusedCount: data.refused_count,
    isBlocked: data.is_blocked,
    blockedReason: data.blocked_reason,
    tags: data.tags,
    addresses: [...data.addresses]
      .sort((a, b) => Number(b.is_default) - Number(a.is_default) || b.created_at.localeCompare(a.created_at))
      .map((a) => ({
        id: a.id,
        label: a.label,
        addressText: a.address_text,
        area: a.area,
        landmark: a.landmark,
        isDefault: a.is_default,
      })),
  };
}

export async function listCustomers(ctx: CurrentContext, search: string, page: number) {
  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("id, name, phone, total_orders, total_spent, last_order_at, tags, is_blocked, cancelled_count, refused_count", {
      count: "exact",
    })
    .eq("restaurant_id", ctx.restaurant.id)
    .order("last_order_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const s = search.trim();
  if (s) {
    const phone = normalizePhone(s);
    if (phone) query = query.eq("phone", phone);
    else if (/^\+?\d{3,}$/.test(s.replace(/[\s-]/g, ""))) query = query.ilike("phone", `%${s.replace(/\D/g, "").slice(-7)}%`);
    else query = query.ilike("name", `%${s.replace(/[%_]/g, "")}%`);
  }
  const { data, count, error } = await query;
  if (error) throw error;
  return { customers: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE };
}

export async function getCustomer(ctx: CurrentContext, customerId: string) {
  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("*, addresses:customer_addresses(id, label, address_text, area, landmark, is_default, latitude, longitude)")
    .eq("id", customerId)
    .eq("restaurant_id", ctx.restaurant.id)
    .maybeSingle();
  if (!customer) return null;
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, status, order_type, total, created_at, branch:branches(name)")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(100);
  return { customer, orders: orders ?? [], timezone: ctx.restaurant.timezone || DEFAULT_TIMEZONE };
}
