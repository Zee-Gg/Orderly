import "server-only";
import type { CurrentContext } from "@/lib/auth/session";
import { reasonLabel } from "@/lib/orders/status";
import { buildSummary, type Summary } from "@/lib/reports/summary";
import { resolveRange, type ResolvedRange } from "@/lib/reports/range";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/time";

/**
 * /reports data (Phase 11). Everything is aggregated in Postgres by the
 * report_* RPCs (security invoker → RLS applies) with the USER client.
 * Sales = delivered + completed orders (see the migration header).
 */

export type ReportBranch = { id: string | null; name: string };

/** Which branch the report shows. "All branches" is for owners only. */
export function resolveReportBranch(ctx: CurrentContext, requested: string | null | undefined): ReportBranch {
  const isOwner = ctx.role === "owner";
  if (requested && requested !== "all") {
    const b = ctx.branches.find((x) => x.id === requested);
    if (b) return { id: b.id, name: b.name };
  }
  if (requested === "all" && isOwner) return { id: null, name: "All branches" };
  if (ctx.currentBranch) return { id: ctx.currentBranch.id, name: ctx.currentBranch.name };
  if (isOwner) return { id: null, name: "All branches" };
  const first = ctx.branches[0];
  return first ? { id: first.id, name: first.name } : { id: null, name: "All branches" };
}

export type Split = { key: string; orders: number; sales: number };

export type Overview = {
  sales: number;
  orders: number;
  received: number;
  cancelled: number;
  failed: number;
  open: number;
  byType: Split[];
  byPayment: Split[];
  byChannel: Split[];
  cancelReasons: { status: "cancelled" | "failed"; reason: string; label: string; count: number }[];
  prepMinutes: number | null;
  deliveryMinutes: number | null;
  late: number;
  customers: { total: number; new: number; repeat: number };
};

export type DayRow = { day: string; sales: number; orders: number };
export type ItemRow = { itemId: string; name: string; qty: number; revenue: number };
export type RiderRow = { riderId: string; name: string; deliveries: number; avgMinutes: number | null; failed: number; cashCollected: number };
export type CustomerRow = { customerId: string; name: string | null; phoneMasked: string | null; orders: number; spent: number };
export type BranchRow = {
  branchId: string;
  name: string;
  sales: number;
  orders: number;
  received: number;
  cancelled: number;
  previousSales: number;
};
export type BotStats = {
  conversations: number;
  handoffs: number;
  botOrders: number;
  botSalesOrders: number;
  menuViews: number;
  cartsSent: number;
  cartOrders: number;
};

export type ReportData = {
  range: ResolvedRange;
  branch: ReportBranch;
  timezone: string;
  current: Overview;
  previous: Overview;
  daily: DayRow[];
  hours: number[];
  topItems: ItemRow[];
  slowItems: { itemId: string; name: string; qty: number }[];
  riders: RiderRow[];
  topCustomers: CustomerRow[];
  bot: BotStats;
  /** Only for owners looking at all branches with 2+ branches. */
  branches: BranchRow[] | null;
  summary: Summary;
};

type Db = Awaited<ReturnType<typeof createClient>>;
type Json = Record<string, unknown>;

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function splits(v: unknown): Split[] {
  return Array.isArray(v) ? v.map((x: Json) => ({ key: String(x.key), orders: num(x.orders), sales: num(x.sales) })) : [];
}

function toOverview(raw: unknown): Overview {
  const j = (raw ?? {}) as Json;
  const c = (j.customers ?? {}) as Json;
  return {
    sales: num(j.sales),
    orders: num(j.orders),
    received: num(j.received),
    cancelled: num(j.cancelled),
    failed: num(j.failed),
    open: num(j.open),
    byType: splits(j.by_type),
    byPayment: splits(j.by_payment),
    byChannel: splits(j.by_channel),
    cancelReasons: Array.isArray(j.cancel_reasons)
      ? j.cancel_reasons.map((x: Json) => {
          const reason = String(x.reason);
          return {
            status: x.status === "failed" ? "failed" : "cancelled",
            reason,
            label: reason === "unknown" ? "No reason given" : reasonLabel(reason),
            count: num(x.count),
          };
        })
      : [],
    prepMinutes: numOrNull(j.prep_minutes),
    deliveryMinutes: numOrNull(j.delivery_minutes),
    late: num(j.late),
    customers: { total: num(c.total), new: num(c.new), repeat: num(c.repeat) },
  };
}

type Args = { p_restaurant_id: string; p_branch_id: string; p_from: string; p_to: string };

function args(restaurantId: string, branchId: string | null, from: string, to: string): Args {
  // The RPCs take null for "all branches"; generated types don't know that.
  return { p_restaurant_id: restaurantId, p_branch_id: branchId as string, p_from: from, p_to: to };
}

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`[reports] ${what}: ${res.error.message}`);
  return res.data as T;
}

export async function getOverview(db: Db, a: Args) {
  return toOverview(check(await db.rpc("report_overview", a), "overview"));
}

export async function getTopItems(db: Db, a: Args, limit = 10) {
  const raw = check(await db.rpc("report_items", { ...a, p_limit: limit }), "items") as Json;
  return {
    top: (Array.isArray(raw?.top) ? raw.top : []).map((x: Json) => ({ itemId: String(x.item_id), name: String(x.name), qty: num(x.qty), revenue: num(x.revenue) })),
    slow: (Array.isArray(raw?.slow) ? raw.slow : []).map((x: Json) => ({ itemId: String(x.item_id), name: String(x.name), qty: num(x.qty) })),
  };
}

export async function getRiders(db: Db, a: Args): Promise<RiderRow[]> {
  const rows = check(await db.rpc("report_riders", a), "riders") ?? [];
  return rows.map((r) => ({
    riderId: r.rider_id,
    name: r.name,
    deliveries: num(r.deliveries),
    avgMinutes: numOrNull(r.avg_minutes),
    failed: num(r.failed),
    cashCollected: num(r.cash_collected),
  }));
}

export async function getReport(
  ctx: CurrentContext,
  params: { range?: string | null; from?: string | null; to?: string | null; branch?: string | null },
): Promise<ReportData> {
  const db = await createClient();
  const timezone = ctx.restaurant.timezone || DEFAULT_TIMEZONE;
  const range = resolveRange(params, timezone);
  const branch = resolveReportBranch(ctx, params.branch);
  const rid = ctx.restaurant.id;
  const cur = args(rid, branch.id, range.from, range.to);
  const prev = args(rid, branch.id, range.compare.from, range.compare.to);
  const showBranches = branch.id === null && ctx.branches.length > 1;

  const [current, previous, daily, hours, items, riders, customers, bot, branchesNow, branchesPrev] = await Promise.all([
    getOverview(db, cur),
    getOverview(db, prev),
    db.rpc("report_daily", args(rid, branch.id, range.chart.from, range.chart.to)),
    db.rpc("report_hours", cur),
    getTopItems(db, cur),
    getRiders(db, cur),
    db.rpc("report_top_customers", cur),
    db.rpc("report_bot", cur),
    showBranches ? db.rpc("report_branches", { p_restaurant_id: rid, p_from: range.from, p_to: range.to }) : null,
    showBranches ? db.rpc("report_branches", { p_restaurant_id: rid, p_from: range.compare.from, p_to: range.compare.to }) : null,
  ]);

  const hourCounts = Array.from({ length: 24 }, () => 0);
  for (const h of check(hours, "hours") ?? []) hourCounts[h.hour] = num(h.orders);

  const botRaw = (check(bot, "bot") ?? {}) as Json;
  const prevSales = new Map((branchesPrev ? check(branchesPrev, "branches") ?? [] : []).map((b) => [b.branch_id, num(b.sales)]));

  const data: Omit<ReportData, "summary"> = {
    range,
    branch,
    timezone,
    current,
    previous,
    daily: (check(daily, "daily") ?? []).map((d) => ({ day: d.day, sales: num(d.sales), orders: num(d.orders) })),
    hours: hourCounts,
    topItems: items.top,
    slowItems: items.slow,
    riders,
    topCustomers: (check(customers, "customers") ?? []).map((c) => ({
      customerId: c.customer_id,
      name: c.name,
      phoneMasked: c.phone_masked,
      orders: num(c.orders),
      spent: num(c.spent),
    })),
    bot: {
      conversations: num(botRaw.conversations),
      handoffs: num(botRaw.handoffs),
      botOrders: num(botRaw.bot_orders),
      botSalesOrders: num(botRaw.bot_sales_orders),
      menuViews: num(botRaw.menu_views),
      cartsSent: num(botRaw.carts_sent),
      cartOrders: num(botRaw.cart_orders),
    },
    branches: branchesNow
      ? (check(branchesNow, "branches") ?? []).map((b) => ({
          branchId: b.branch_id,
          name: b.name,
          sales: num(b.sales),
          orders: num(b.orders),
          received: num(b.received),
          cancelled: num(b.cancelled),
          previousSales: prevSales.get(b.branch_id) ?? 0,
        }))
      : null,
  };

  const summary = buildSummary({
    range,
    orders: current.orders,
    sales: current.sales,
    previousOrders: previous.orders,
    open: current.open,
    topItem: data.topItems[0]?.name ?? null,
    hours: hourCounts,
  });
  return { ...data, summary };
}

export async function exportArgs(ctx: CurrentContext, params: { range?: string | null; from?: string | null; to?: string | null; branch?: string | null }) {
  const timezone = ctx.restaurant.timezone || DEFAULT_TIMEZONE;
  const range = resolveRange(params, timezone);
  const branch = resolveReportBranch(ctx, params.branch);
  return { range, branch, timezone, args: args(ctx.restaurant.id, branch.id, range.from, range.to) };
}
