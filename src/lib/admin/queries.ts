import "server-only";
import { toPlan, toSubscription, limitWarnings, type Plan, type Subscription } from "@/lib/billing/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_TIMEZONE, monthStart, todayRange } from "@/lib/time";

/**
 * Super admin reads (Phase 12). ADMIN client — every caller must have called
 * requireSuperAdmin() first. Platform-wide numbers use Asia/Karachi days.
 */
const TZ = DEFAULT_TIMEZONE;
const HOUR = 3600_000;

type Admin = ReturnType<typeof createAdminClient>;

function count(res: { count: number | null }) {
  return res.count ?? 0;
}

export type PlatformOverview = {
  restaurants: Record<"trial" | "active" | "past_due" | "suspended" | "cancelled", number> & { total: number };
  ordersToday: number;
  ordersMonth: number;
  messagesToday: number;
  aiCostMonth: number;
  aiTurnsMonth: number;
  overLimit: number;
  errors: { failedWebhooks: number; failedSends: number; aiErrors: number };
  recentErrors: { at: string; kind: string; text: string; restaurantId: string | null }[];
};

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const db = createAdminClient();
  const { start } = todayRange(TZ);
  const month = monthStart(TZ).toISOString();
  const since = new Date(Date.now() - 24 * HOUR).toISOString();
  const head = { count: "exact" as const, head: true };

  const [subs, ordersToday, ordersMonth, messagesToday, ai, failedHooks, failedSends, aiErrors, hookErrs, sendErrs, aiErrs, restaurants] = await Promise.all([
    db.from("restaurant_subscriptions").select("status"),
    db.from("orders").select("id", head).gte("created_at", start.toISOString()).neq("status", "pending_confirmation"),
    db.from("orders").select("id", head).gte("created_at", month).neq("status", "pending_confirmation"),
    db.from("whatsapp_messages").select("id", head).gte("created_at", start.toISOString()).neq("sender_type", "system"),
    db.from("ai_logs").select("estimated_cost").gte("created_at", month).limit(50000),
    db.from("whatsapp_webhook_events").select("id", head).gte("received_at", since).not("error", "is", null),
    db.from("whatsapp_messages").select("id", head).gte("created_at", since).eq("status", "failed"),
    db.from("ai_logs").select("id", head).gte("created_at", since).in("error_type", ["error", "timeout", "rate_limit"]),
    db.from("whatsapp_webhook_events").select("received_at, error").not("error", "is", null).order("received_at", { ascending: false }).limit(5),
    db.from("whatsapp_messages").select("created_at, error, restaurant_id").eq("status", "failed").order("created_at", { ascending: false }).limit(5),
    db.from("ai_logs").select("created_at, error_type, error, restaurant_id").in("error_type", ["error", "timeout", "rate_limit"]).order("created_at", { ascending: false }).limit(5),
    listRestaurants({}),
  ]);

  const byStatus = { trial: 0, active: 0, past_due: 0, suspended: 0, cancelled: 0 };
  for (const s of subs.data ?? []) if (s.status in byStatus) byStatus[s.status as keyof typeof byStatus]++;
  const recentErrors = [
    ...(hookErrs.data ?? []).map((e) => ({ at: e.received_at, kind: "Webhook", text: e.error ?? "", restaurantId: null })),
    ...(sendErrs.data ?? []).map((e) => ({ at: e.created_at, kind: "WhatsApp send", text: e.error ?? "Failed", restaurantId: e.restaurant_id })),
    ...(aiErrs.data ?? []).map((e) => ({ at: e.created_at, kind: `AI ${e.error_type}`, text: e.error ?? "", restaurantId: e.restaurant_id })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);

  return {
    restaurants: { ...byStatus, total: (subs.data ?? []).length },
    ordersToday: count(ordersToday),
    ordersMonth: count(ordersMonth),
    messagesToday: count(messagesToday),
    aiCostMonth: (ai.data ?? []).reduce((n, r) => n + Number(r.estimated_cost ?? 0), 0),
    aiTurnsMonth: (ai.data ?? []).length,
    overLimit: restaurants.filter((r) => r.overLimit.length > 0).length,
    errors: { failedWebhooks: count(failedHooks), failedSends: count(failedSends), aiErrors: count(aiErrors) },
    recentErrors,
  };
}

export type RestaurantRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  createdAt: string;
  ownerName: string | null;
  ownerEmail: string | null;
  branches: number;
  whatsappConnected: boolean;
  plan: Plan | null;
  subscription: Subscription | null;
  lastOrderAt: string | null;
  ordersThisMonth: number;
  botConversationsThisMonth: number;
  overLimit: string[];
};

export async function listRestaurants(filter: { q?: string; status?: string }): Promise<RestaurantRow[]> {
  const db = createAdminClient();
  const [restaurants, subs, plans, owners, wa, usage] = await Promise.all([
    db.from("restaurants").select("id, name, slug, city, created_at").order("created_at", { ascending: false }).limit(1000),
    db.from("restaurant_subscriptions").select("restaurant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end, past_due_since, suspended_at"),
    db.from("plans").select("id, name, description, monthly_price, max_branches, max_orders_per_month, max_bot_conversations_per_month, is_active, sort_order"),
    db.from("memberships").select("restaurant_id, user_id, profile:profiles(full_name)").eq("role", "owner").eq("is_active", true),
    db.from("whatsapp_accounts").select("restaurant_id").eq("is_active", true),
    db.rpc("admin_restaurant_usage", { p_month_start: monthStart(TZ).toISOString() }),
  ]);
  const subOf = new Map((subs.data ?? []).map((s) => [s.restaurant_id, toSubscription(s)]));
  const planOf = new Map((plans.data ?? []).map((p) => [p.id, toPlan(p)]));
  const ownerOf = new Map<string, { userId: string; name: string | null }>();
  for (const m of owners.data ?? []) {
    if (!ownerOf.has(m.restaurant_id)) {
      const profile = m.profile as { full_name: string | null } | null;
      ownerOf.set(m.restaurant_id, { userId: m.user_id, name: profile?.full_name ?? null });
    }
  }
  const waSet = new Set((wa.data ?? []).map((w) => w.restaurant_id));
  const usageOf = new Map((usage.data ?? []).map((u) => [u.restaurant_id, u]));

  const q = filter.q?.trim().toLowerCase() ?? "";
  return (restaurants.data ?? [])
    .map((r): RestaurantRow => {
      const sub = subOf.get(r.id) ?? null;
      const plan = sub?.planId ? (planOf.get(sub.planId) ?? null) : null;
      const u = usageOf.get(r.id);
      const owner = ownerOf.get(r.id);
      const usageNow = { branches: Number(u?.branches ?? 0), orders: Number(u?.orders_this_month ?? 0), botConversations: Number(u?.bot_conversations_this_month ?? 0) };
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        city: r.city,
        createdAt: r.created_at,
        ownerName: owner?.name ?? null,
        ownerEmail: null,
        branches: usageNow.branches,
        whatsappConnected: waSet.has(r.id),
        plan,
        subscription: sub,
        lastOrderAt: u?.last_order_at ?? null,
        ordersThisMonth: usageNow.orders,
        botConversationsThisMonth: usageNow.botConversations,
        overLimit: limitWarnings(plan, usageNow).map((w) => w.text),
      };
    })
    .filter((r) => !filter.status || filter.status === "all" || r.subscription?.status === filter.status || (filter.status === "over_limit" && r.overLimit.length > 0))
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.slug.includes(q) || (r.ownerName ?? "").toLowerCase().includes(q) || (r.city ?? "").toLowerCase().includes(q));
}

export type RestaurantDetail = {
  row: RestaurantRow;
  restaurant: { id: string; name: string; slug: string; city: string | null; phone: string | null; timezone: string; status: string; createdAt: string };
  members: { userId: string; name: string | null; email: string | null; role: string; branch: string | null; isActive: boolean }[];
  branches: { id: string; name: string; area: string | null; isOpen: boolean; isActive: boolean }[];
  whatsapp: { displayPhone: string; phoneNumberId: string; isActive: boolean; connectedAt: string | null } | null;
  payments: { id: string; receiptNumber: number; amount: number; method: string; reference: string | null; periodStart: string; periodEnd: string; createdAt: string }[];
  notes: string | null;
};

export async function getRestaurantDetail(id: string): Promise<RestaurantDetail | null> {
  const db = createAdminClient();
  const { data: r } = await db.from("restaurants").select("id, name, slug, city, phone, timezone, status, created_at").eq("id", id).maybeSingle();
  if (!r) return null;
  const [rows, members, branches, wa, payments, sub] = await Promise.all([
    listRestaurants({}),
    db.from("memberships").select("user_id, role, branch_id, is_active, profile:profiles(full_name)").eq("restaurant_id", id).order("created_at"),
    db.from("branches").select("id, name, area, is_open, is_active").eq("restaurant_id", id).order("created_at"),
    db.from("whatsapp_accounts").select("display_phone_number, phone_number_id, is_active, connected_at").eq("restaurant_id", id).maybeSingle(),
    db.from("subscription_payments").select("id, receipt_number, amount, method, reference, period_start, period_end, created_at").eq("restaurant_id", id).order("created_at", { ascending: false }),
    db.from("restaurant_subscriptions").select("notes").eq("restaurant_id", id).maybeSingle(),
  ]);
  const row = rows.find((x) => x.id === id);
  if (!row) return null;
  const branchName = new Map((branches.data ?? []).map((b) => [b.id, b.name]));
  const emails = await emailsFor(db, (members.data ?? []).map((m) => m.user_id));
  return {
    row: { ...row, ownerEmail: emails.get((members.data ?? []).find((m) => m.role === "owner")?.user_id ?? "") ?? null },
    restaurant: { id: r.id, name: r.name, slug: r.slug, city: r.city, phone: r.phone, timezone: r.timezone || TZ, status: r.status, createdAt: r.created_at },
    members: (members.data ?? []).map((m) => ({
      userId: m.user_id,
      name: (m.profile as { full_name: string | null } | null)?.full_name ?? null,
      email: emails.get(m.user_id) ?? null,
      role: m.role,
      branch: m.branch_id ? (branchName.get(m.branch_id) ?? "Branch") : null,
      isActive: m.is_active,
    })),
    branches: (branches.data ?? []).map((b) => ({ id: b.id, name: b.name, area: b.area, isOpen: b.is_open, isActive: b.is_active })),
    whatsapp: wa.data ? { displayPhone: wa.data.display_phone_number, phoneNumberId: wa.data.phone_number_id, isActive: wa.data.is_active, connectedAt: wa.data.connected_at } : null,
    payments: (payments.data ?? []).map((p) => ({
      id: p.id,
      receiptNumber: p.receipt_number,
      amount: p.amount,
      method: p.method,
      reference: p.reference,
      periodStart: p.period_start,
      periodEnd: p.period_end,
      createdAt: p.created_at,
    })),
    notes: sub.data?.notes ?? null,
  };
}

/** Login emails for a few users (auth admin API; never sent to other restaurants). */
async function emailsFor(db: Admin, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    [...new Set(userIds)].slice(0, 50).map(async (uid) => {
      const { data } = await db.auth.admin.getUserById(uid);
      if (data.user?.email) out.set(uid, data.user.email);
    }),
  );
  return out;
}

export type SupportSnapshot = {
  ordersToday: number;
  salesToday: number;
  openOrders: number;
  recentOrders: { orderNumber: number; createdAt: string; status: string; orderType: string; source: string; total: number; branch: string }[];
  menuItems: number;
  categories: number;
  customers: number;
  openChats: number;
  needsStaff: number;
  riders: { name: string; isOnline: boolean; isActive: boolean }[];
  zones: number;
  lastWebhookAt: string | null;
};

/** Read-only numbers for the support view. No phones/addresses. */
export async function getSupportSnapshot(restaurantId: string, timeZone: string): Promise<SupportSnapshot> {
  const db = createAdminClient();
  const { start } = todayRange(timeZone);
  const head = { count: "exact" as const, head: true };
  const [today, open, recent, items, cats, customers, chats, needs, riders, zones, branches, wa] = await Promise.all([
    db.from("orders").select("status, total").eq("restaurant_id", restaurantId).gte("created_at", start.toISOString()).neq("status", "pending_confirmation").limit(5000),
    db.from("orders").select("id", head).eq("restaurant_id", restaurantId).in("status", ["awaiting_acceptance", "accepted", "preparing", "ready", "out_for_delivery"]),
    db.from("orders").select("order_number, created_at, status, order_type, source, total, branch_id").eq("restaurant_id", restaurantId).neq("status", "pending_confirmation").order("created_at", { ascending: false }).limit(20),
    db.from("menu_items").select("id", head).eq("restaurant_id", restaurantId).is("archived_at", null),
    db.from("menu_categories").select("id", head).eq("restaurant_id", restaurantId).is("archived_at", null),
    db.from("customers").select("id", head).eq("restaurant_id", restaurantId),
    db.from("whatsapp_conversations").select("id", head).eq("restaurant_id", restaurantId).eq("status", "open"),
    db.from("whatsapp_conversations").select("id", head).eq("restaurant_id", restaurantId).eq("needs_staff", true).eq("status", "open"),
    db.from("rider_profiles").select("name, is_online, is_active").eq("restaurant_id", restaurantId).order("name"),
    db.from("delivery_zones").select("id", head).eq("restaurant_id", restaurantId).eq("is_active", true),
    db.from("branches").select("id, name").eq("restaurant_id", restaurantId),
    db.from("whatsapp_messages").select("created_at").eq("restaurant_id", restaurantId).eq("direction", "inbound").order("created_at", { ascending: false }).limit(1),
  ]);
  const sales = (today.data ?? []).filter((o) => o.status === "delivered" || o.status === "completed");
  const branchName = new Map((branches.data ?? []).map((b) => [b.id, b.name]));
  return {
    ordersToday: sales.length,
    salesToday: sales.reduce((n, o) => n + o.total, 0),
    openOrders: count(open),
    recentOrders: (recent.data ?? []).map((o) => ({
      orderNumber: o.order_number,
      createdAt: o.created_at,
      status: o.status,
      orderType: o.order_type,
      source: o.source,
      total: o.total,
      branch: branchName.get(o.branch_id) ?? "",
    })),
    menuItems: count(items),
    categories: count(cats),
    customers: count(customers),
    openChats: count(chats),
    needsStaff: count(needs),
    riders: (riders.data ?? []).map((r) => ({ name: r.name, isOnline: r.is_online, isActive: r.is_active })),
    zones: count(zones),
    lastWebhookAt: wa.data?.[0]?.created_at ?? null,
  };
}

export type HealthData = {
  lastWebhookAt: string | null;
  failedWebhooks: { at: string; error: string }[];
  failedSends: { at: string; error: string; restaurantId: string }[];
  aiErrors: number;
  aiRateLimits: number;
  aiTimeouts: number;
  aiTurns: number;
  jobs: { job: string; lastRunAt: string; ok: boolean; result: unknown; error: string | null; runs: number }[];
  /** When this was read (ms), to judge whether a job is late. */
  checkedAt: number;
};

export async function getHealthData(): Promise<HealthData> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 24 * HOUR).toISOString();
  const head = { count: "exact" as const, head: true };
  const [last, hooks, sends, errors, limits, timeouts, turns, jobs] = await Promise.all([
    db.from("whatsapp_webhook_events").select("received_at").order("received_at", { ascending: false }).limit(1),
    db.from("whatsapp_webhook_events").select("received_at, error").gte("received_at", since).not("error", "is", null).order("received_at", { ascending: false }).limit(20),
    db.from("whatsapp_messages").select("created_at, error, restaurant_id").gte("created_at", since).eq("status", "failed").order("created_at", { ascending: false }).limit(20),
    db.from("ai_logs").select("id", head).gte("created_at", since).eq("error_type", "error"),
    db.from("ai_logs").select("id", head).gte("created_at", since).eq("error_type", "rate_limit"),
    db.from("ai_logs").select("id", head).gte("created_at", since).eq("error_type", "timeout"),
    db.from("ai_logs").select("id", head).gte("created_at", since),
    db.from("job_runs").select("job, last_run_at, last_ok, last_result, last_error, run_count").order("job"),
  ]);
  return {
    lastWebhookAt: last.data?.[0]?.received_at ?? null,
    failedWebhooks: (hooks.data ?? []).map((h) => ({ at: h.received_at, error: h.error ?? "" })),
    failedSends: (sends.data ?? []).map((s) => ({ at: s.created_at, error: s.error ?? "Failed", restaurantId: s.restaurant_id })),
    aiErrors: count(errors),
    aiRateLimits: count(limits),
    aiTimeouts: count(timeouts),
    aiTurns: count(turns),
    jobs: (jobs.data ?? []).map((j) => ({ job: j.job, lastRunAt: j.last_run_at, ok: j.last_ok, result: j.last_result, error: j.last_error, runs: Number(j.run_count) })),
    checkedAt: Date.now(),
  };
}
