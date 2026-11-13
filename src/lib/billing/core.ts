/**
 * Plans + subscriptions (Phase 12). Pure helpers (no DB, no Next.js) so the
 * dashboard banners, /settings/billing and /admin all use the same rules.
 * Payments are manual (bank transfer, JazzCash, Easypaisa, cash): no gateway.
 */
export const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trial: "Free trial",
  active: "Active",
  past_due: "Payment due",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

export const PAYMENT_METHODS = ["bank_transfer", "jazzcash", "easypaisa", "cash"] as const;
export type SubscriptionPaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SUBSCRIPTION_PAYMENT_LABELS: Record<SubscriptionPaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  jazzcash: "JazzCash",
  easypaisa: "Easypaisa",
  cash: "Cash",
};

export type Plan = {
  id: string;
  name: string;
  description: string | null;
  monthlyPrice: number; // paisa
  maxBranches: number;
  maxOrdersPerMonth: number | null;
  maxBotConversationsPerMonth: number | null;
  isActive: boolean;
  sortOrder: number;
};

export type Subscription = {
  restaurantId: string;
  planId: string | null;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  pastDueSince: string | null;
  suspendedAt: string | null;
};

export type Usage = { branches: number; orders: number; botConversations: number };

const DAY = 86400_000;

/** Whole days left until `iso` (0 = today/over). */
export function daysLeft(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((Date.parse(iso) - now.getTime()) / DAY));
}

/** When the restaurant must pay next (trial end, or period end). */
export function nextDueDate(sub: Subscription): string | null {
  return sub.status === "trial" ? sub.trialEndsAt : sub.currentPeriodEnd;
}

export type BillingBanner = { tone: "info" | "warning" | "danger"; title: string; body: string } | null;

/**
 * Owner banner: trial ending (≤ 3 days), period ending (≤ 3 days), payment
 * due (grace period), suspended.
 */
export function billingBanner(sub: Subscription | null, graceDays: number, now: Date = new Date()): BillingBanner {
  if (!sub) return null;
  if (sub.status === "suspended" || sub.status === "cancelled") {
    return { tone: "danger", title: "Account suspended — contact us", body: "Online ordering is off. Pay to switch it back on." };
  }
  if (sub.status === "past_due") {
    const since = sub.pastDueSince ? Date.parse(sub.pastDueSince) : now.getTime();
    const left = Math.max(0, Math.ceil((since + graceDays * DAY - now.getTime()) / DAY));
    return {
      tone: "danger",
      title: "Payment due",
      body: left > 0 ? `Please pay within ${left} day${left === 1 ? "" : "s"} to keep online ordering on.` : "Please pay today to keep online ordering on.",
    };
  }
  const due = nextDueDate(sub);
  const left = daysLeft(due, now);
  if (left === null || left > 3) return null;
  if (sub.status === "trial") {
    return {
      tone: "warning",
      title: left === 0 ? "Your trial ends today" : `Your trial ends in ${left} day${left === 1 ? "" : "s"}`,
      body: "Choose a plan and pay to keep receiving orders.",
    };
  }
  return {
    tone: "info",
    title: left === 0 ? "Your plan renews today" : `Your plan renews in ${left} day${left === 1 ? "" : "s"}`,
    body: "Pay before the date to avoid any break.",
  };
}

export type LimitWarning = { key: "branches" | "orders" | "bot"; text: string };

/** Over the plan's limits? (Warnings only — orders are never blocked.) */
export function limitWarnings(plan: Pick<Plan, "maxBranches" | "maxOrdersPerMonth" | "maxBotConversationsPerMonth"> | null, usage: Usage): LimitWarning[] {
  if (!plan) return [];
  const out: LimitWarning[] = [];
  if (usage.branches > plan.maxBranches) out.push({ key: "branches", text: `${usage.branches} branches (plan allows ${plan.maxBranches})` });
  if (plan.maxOrdersPerMonth !== null && usage.orders > plan.maxOrdersPerMonth) {
    out.push({ key: "orders", text: `${usage.orders} orders this month (plan allows ${plan.maxOrdersPerMonth})` });
  }
  if (plan.maxBotConversationsPerMonth !== null && usage.botConversations > plan.maxBotConversationsPerMonth) {
    out.push({ key: "bot", text: `${usage.botConversations} bot chats this month (plan allows ${plan.maxBotConversationsPerMonth})` });
  }
  return out;
}

/** "Unlimited" / "1,500" */
export function limitText(n: number | null): string {
  return n === null ? "Unlimited" : n.toLocaleString("en-PK");
}

export function toPlan(r: {
  id: string;
  name: string;
  description: string | null;
  monthly_price: number;
  max_branches: number;
  max_orders_per_month: number | null;
  max_bot_conversations_per_month: number | null;
  is_active: boolean;
  sort_order: number;
}): Plan {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    monthlyPrice: r.monthly_price,
    maxBranches: r.max_branches,
    maxOrdersPerMonth: r.max_orders_per_month,
    maxBotConversationsPerMonth: r.max_bot_conversations_per_month,
    isActive: r.is_active,
    sortOrder: r.sort_order,
  };
}

export function toSubscription(r: {
  restaurant_id: string;
  plan_id: string | null;
  status: string;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  past_due_since: string | null;
  suspended_at: string | null;
}): Subscription {
  return {
    restaurantId: r.restaurant_id,
    planId: r.plan_id,
    status: (SUBSCRIPTION_STATUSES as readonly string[]).includes(r.status) ? (r.status as SubscriptionStatus) : "trial",
    trialEndsAt: r.trial_ends_at,
    currentPeriodStart: r.current_period_start,
    currentPeriodEnd: r.current_period_end,
    pastDueSince: r.past_due_since,
    suspendedAt: r.suspended_at,
  };
}

/** wa.me link for a digits-only number, with an optional message. */
export function waLink(digits: string | null | undefined, text?: string): string | null {
  if (!digits) return null;
  const d = digits.replace(/\D/g, "");
  if (d.length < 8) return null;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
