import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthStart } from "@/lib/time";
import type { Database } from "@/types/database";
import { toPlan, toSubscription, type Plan, type Subscription, type SubscriptionPaymentMethod, type Usage } from "./core";

type Db = SupabaseClient<Database>;

export type PlatformSettings = {
  defaultTrialDays: number;
  gracePeriodDays: number;
  paymentInstructions: string | null;
  salesWhatsapp: string | null;
  supportPhone: string | null;
};

export type SubscriptionPayment = {
  id: string;
  receiptNumber: number;
  amount: number;
  method: SubscriptionPaymentMethod;
  reference: string | null;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  planId: string | null;
};

export type Billing = {
  subscription: Subscription | null;
  plan: Plan | null;
  payments: SubscriptionPayment[];
  settings: PlatformSettings;
};

const DEFAULT_SETTINGS: PlatformSettings = {
  defaultTrialDays: 14,
  gracePeriodDays: 5,
  paymentInstructions: null,
  salesWhatsapp: null,
  supportPhone: null,
};

/** Works with the user client (owners: RLS) or the admin client (super admin). */
export async function getPlatformSettings(db: Db): Promise<PlatformSettings> {
  const { data } = await db
    .from("platform_settings")
    .select("default_trial_days, grace_period_days, payment_instructions, sales_whatsapp, support_phone")
    .maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  return {
    defaultTrialDays: data.default_trial_days,
    gracePeriodDays: data.grace_period_days,
    paymentInstructions: data.payment_instructions,
    salesWhatsapp: data.sales_whatsapp,
    supportPhone: data.support_phone,
  };
}

export async function listPlans(db: Db, { activeOnly = true } = {}): Promise<Plan[]> {
  let q = db
    .from("plans")
    .select("id, name, description, monthly_price, max_branches, max_orders_per_month, max_bot_conversations_per_month, is_active, sort_order")
    .order("sort_order")
    .order("monthly_price");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toPlan);
}

export async function getSubscription(db: Db, restaurantId: string): Promise<Subscription | null> {
  const { data } = await db
    .from("restaurant_subscriptions")
    .select("restaurant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end, past_due_since, suspended_at")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  return data ? toSubscription(data) : null;
}

export async function getBilling(db: Db, restaurantId: string): Promise<Billing> {
  const [subscription, settings, payments] = await Promise.all([
    getSubscription(db, restaurantId),
    getPlatformSettings(db),
    db
      .from("subscription_payments")
      .select("id, receipt_number, amount, method, reference, period_start, period_end, created_at, plan_id")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  let plan: Plan | null = null;
  if (subscription?.planId) {
    const { data } = await db
      .from("plans")
      .select("id, name, description, monthly_price, max_branches, max_orders_per_month, max_bot_conversations_per_month, is_active, sort_order")
      .eq("id", subscription.planId)
      .maybeSingle();
    plan = data ? toPlan(data) : null;
  }
  return {
    subscription,
    plan,
    settings,
    payments: (payments.data ?? []).map((p) => ({
      id: p.id,
      receiptNumber: p.receipt_number,
      amount: p.amount,
      method: p.method as SubscriptionPaymentMethod,
      reference: p.reference,
      periodStart: p.period_start,
      periodEnd: p.period_end,
      createdAt: p.created_at,
      planId: p.plan_id,
    })),
  };
}

/** This month's usage for one restaurant (owner/manager or super admin). */
export async function getUsage(db: Db, restaurantId: string, timeZone: string): Promise<Usage> {
  const { data } = await db.rpc("restaurant_usage", { p_restaurant_id: restaurantId, p_month_start: monthStart(timeZone).toISOString() });
  const j = (data ?? {}) as Record<string, unknown>;
  return { branches: Number(j.branches ?? 0), orders: Number(j.orders ?? 0), botConversations: Number(j.bot_conversations ?? 0) };
}
