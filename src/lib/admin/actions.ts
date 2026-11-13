"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { writeAuditLog } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/auth/session";
import { PAYMENT_METHODS } from "@/lib/billing/core";
import { revalidatePublicMenu } from "@/lib/menu/public-cache";
import { parseRupees } from "@/lib/money";
import { revalidatePlatform } from "@/lib/public/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

/**
 * Super admin actions (Phase 12). requireSuperAdmin() first, then the admin
 * client. Every change is written to the restaurant's audit_logs.
 */
const uuid = z.uuid();

async function audit(restaurantId: string, userId: string, action: Parameters<typeof writeAuditLog>[1]["action"], newData: Record<string, unknown>) {
  await writeAuditLog(createAdminClient(), {
    restaurantId,
    userId,
    action,
    entityType: "restaurant",
    entityId: restaurantId,
    newData: newData as never,
  });
}

function refresh(restaurantId: string) {
  revalidatePath("/admin", "layout");
  // Menu page shows "not available" while suspended.
  revalidatePublicMenu(restaurantId);
}

// ---------------------------------------------------------------------------
// Subscription controls
// ---------------------------------------------------------------------------
const statusSchema = z.object({ restaurantId: uuid, action: z.enum(["suspend", "reactivate"]) });

export async function setRestaurantAccessAction(input: z.input<typeof statusSchema>): Promise<ActionResult> {
  try {
    const user = await requireSuperAdmin();
    const parsed = statusSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const { restaurantId, action } = parsed.data;
    const db = createAdminClient();
    const { data: sub } = await db.from("restaurant_subscriptions").select("status, trial_ends_at, current_period_end").eq("restaurant_id", restaurantId).maybeSingle();
    if (!sub) return { ok: false, error: "No subscription found." };
    let next: Database["public"]["Tables"]["restaurant_subscriptions"]["Update"];
    if (action === "suspend") {
      next = { status: "suspended", suspended_at: new Date().toISOString() };
    } else {
      // Back to trial if the trial is still running, otherwise active
      // (with a period end, the hourly sweep keeps checking payment).
      const now = Date.now();
      const trialLeft = sub.trial_ends_at && Date.parse(sub.trial_ends_at) > now;
      const paidLeft = sub.current_period_end && Date.parse(sub.current_period_end) > now;
      next = trialLeft
        ? { status: "trial", suspended_at: null, past_due_since: null }
        : { status: "active", suspended_at: null, past_due_since: null, ...(paidLeft ? {} : { current_period_end: new Date(now + 7 * 86400_000).toISOString() }) };
    }
    const { error } = await db.from("restaurant_subscriptions").update(next).eq("restaurant_id", restaurantId);
    if (error) throw error;
    await audit(restaurantId, user.id, "subscription.changed", { action, ...next });
    refresh(restaurantId);
    return { ok: true, message: action === "suspend" ? "Suspended" : "Reactivated" };
  } catch (err) {
    return failure(err, "Couldn't change the account.");
  }
}

const extendSchema = z.object({ restaurantId: uuid, days: z.number().int().min(1).max(365) });

export async function extendTrialAction(input: z.input<typeof extendSchema>): Promise<ActionResult> {
  try {
    const user = await requireSuperAdmin();
    const parsed = extendSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const { restaurantId, days } = parsed.data;
    const db = createAdminClient();
    const { data: sub } = await db.from("restaurant_subscriptions").select("trial_ends_at").eq("restaurant_id", restaurantId).maybeSingle();
    if (!sub) return { ok: false, error: "No subscription found." };
    const from = Math.max(Date.now(), sub.trial_ends_at ? Date.parse(sub.trial_ends_at) : 0);
    const trialEndsAt = new Date(from + days * 86400_000).toISOString();
    const { error } = await db
      .from("restaurant_subscriptions")
      .update({ status: "trial", trial_ends_at: trialEndsAt, past_due_since: null, suspended_at: null })
      .eq("restaurant_id", restaurantId);
    if (error) throw error;
    await audit(restaurantId, user.id, "subscription.changed", { action: "extend_trial", days, trial_ends_at: trialEndsAt });
    refresh(restaurantId);
    return { ok: true, message: `Trial extended by ${days} days` };
  } catch (err) {
    return failure(err, "Couldn't extend the trial.");
  }
}

const planSchema = z.object({ restaurantId: uuid, planId: uuid });

export async function changePlanAction(input: z.input<typeof planSchema>): Promise<ActionResult> {
  try {
    const user = await requireSuperAdmin();
    const parsed = planSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const db = createAdminClient();
    const { error } = await db.from("restaurant_subscriptions").update({ plan_id: parsed.data.planId }).eq("restaurant_id", parsed.data.restaurantId);
    if (error) throw error;
    await audit(parsed.data.restaurantId, user.id, "subscription.changed", { action: "change_plan", plan_id: parsed.data.planId });
    refresh(parsed.data.restaurantId);
    return { ok: true, message: "Plan changed" };
  } catch (err) {
    return failure(err, "Couldn't change the plan.");
  }
}

const paymentSchema = z.object({
  restaurantId: uuid,
  amount: z.string().trim().min(1, "Enter the amount"),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function recordPaymentAction(input: z.input<typeof paymentSchema>): Promise<ActionResult<{ paymentId: string }>> {
  try {
    const user = await requireSuperAdmin();
    const parsed = paymentSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const amount = parseRupees(parsed.data.amount);
    if (!amount || amount <= 0) return { ok: false, error: "Enter a valid amount.", fieldErrors: { amount: "Like 4999" } };
    const db = createAdminClient();
    const { data, error } = await db.rpc("admin_record_subscription_payment", {
      p_restaurant_id: parsed.data.restaurantId,
      p_amount: amount,
      p_method: parsed.data.method,
      p_reference: parsed.data.reference ?? "",
      p_notes: parsed.data.notes ?? "",
      p_recorded_by: user.id,
    });
    if (error) throw error;
    await audit(parsed.data.restaurantId, user.id, "subscription.payment_recorded", { payment_id: data, amount, method: parsed.data.method, reference: parsed.data.reference ?? null });
    refresh(parsed.data.restaurantId);
    return { ok: true, data: { paymentId: data as string }, message: "Payment recorded — account active for one more month" };
  } catch (err) {
    return failure(err, "Couldn't record the payment.");
  }
}

const notesSchema = z.object({ restaurantId: uuid, notes: z.string().trim().max(1000) });

export async function saveSubscriptionNotesAction(input: z.input<typeof notesSchema>): Promise<ActionResult> {
  try {
    await requireSuperAdmin();
    const parsed = notesSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const { error } = await createAdminClient()
      .from("restaurant_subscriptions")
      .update({ notes: parsed.data.notes || null })
      .eq("restaurant_id", parsed.data.restaurantId);
    if (error) throw error;
    revalidatePath("/admin", "layout");
    return { ok: true, message: "Saved" };
  } catch (err) {
    return failure(err, "Couldn't save.");
  }
}

// ---------------------------------------------------------------------------
// Create a restaurant + owner login for a client
// ---------------------------------------------------------------------------
const createSchema = z.object({
  name: z.string().trim().min(2, "At least 2 letters").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "3–40 letters, numbers or dashes"),
  city: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(30).optional(),
  branchName: z.string().trim().min(1, "Enter a branch name").max(80),
  ownerName: z.string().trim().min(2, "Enter the owner's name").max(120),
  ownerEmail: z.email("Enter a valid email").trim().toLowerCase(),
  tempPassword: z.string().min(8, "At least 8 characters").max(72),
  planId: uuid.nullish(),
  trialDays: z.number().int().min(0).max(365),
});

export async function createRestaurantForClientAction(input: z.input<typeof createSchema>): Promise<ActionResult<{ restaurantId: string }>> {
  try {
    const user = await requireSuperAdmin();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    const db = createAdminClient();

    const { data: taken } = await db.from("restaurants").select("id").eq("slug", v.slug).maybeSingle();
    if (taken) return { ok: false, error: "This link is already used.", fieldErrors: { slug: "Already used" } };

    const { data: created, error: createError } = await db.auth.admin.createUser({
      email: v.ownerEmail,
      password: v.tempPassword,
      email_confirm: true,
      user_metadata: { full_name: v.ownerName },
    });
    if (createError || !created.user) {
      const msg = createError?.message.toLowerCase() ?? "";
      if (createError?.code === "email_exists" || msg.includes("already")) {
        return { ok: false, error: "This email already has an account.", fieldErrors: { ownerEmail: "Already has an account" } };
      }
      if (createError?.code === "weak_password" || msg.includes("password")) {
        return { ok: false, error: "Choose a stronger temporary password.", fieldErrors: { tempPassword: "Too weak" } };
      }
      throw createError ?? new Error("createUser returned no user");
    }
    const ownerId = created.user.id;
    await db.from("profiles").update({ full_name: v.ownerName, must_change_password: true }).eq("id", ownerId);

    const { data: restaurantId, error } = await db.rpc("admin_create_restaurant", {
      p_owner_id: ownerId,
      p_name: v.name,
      p_slug: v.slug,
      p_city: v.city ?? "",
      p_phone: v.phone ?? "",
      p_branch_name: v.branchName,
      p_plan_id: (v.planId ?? null) as string,
      p_trial_days: v.trialDays,
      p_created_by: user.id,
    });
    if (error || !restaurantId) {
      await db.auth.admin.deleteUser(ownerId); // no orphan login
      if (error?.message.includes("reserved")) return { ok: false, error: error.message, fieldErrors: { slug: "Reserved" } };
      throw error ?? new Error("admin_create_restaurant returned nothing");
    }
    await audit(restaurantId as string, user.id, "restaurant.created_for_client", { owner_email: v.ownerEmail, plan_id: v.planId ?? null, trial_days: v.trialDays });
    revalidatePath("/admin", "layout");
    return { ok: true, data: { restaurantId: restaurantId as string }, message: "Restaurant created" };
  } catch (err) {
    return failure(err, "Couldn't create the restaurant.");
  }
}

// ---------------------------------------------------------------------------
// Platform settings + plans
// ---------------------------------------------------------------------------
const settingsSchema = z.object({
  defaultTrialDays: z.number().int().min(0).max(365),
  gracePeriodDays: z.number().int().min(0).max(60),
  paymentInstructions: z.string().trim().max(2000),
  salesWhatsapp: z
    .string()
    .trim()
    .transform((s) => s.replace(/\D/g, ""))
    .transform((s) => (s.startsWith("0") ? `92${s.slice(1)}` : s))
    .pipe(z.string().regex(/^(|[0-9]{8,15})$/, "Like 923001234567")),
  supportPhone: z.string().trim().max(30),
});

export async function savePlatformSettingsAction(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  try {
    const user = await requireSuperAdmin();
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    const { error } = await createAdminClient()
      .from("platform_settings")
      .update({
        default_trial_days: v.defaultTrialDays,
        grace_period_days: v.gracePeriodDays,
        payment_instructions: v.paymentInstructions || null,
        sales_whatsapp: v.salesWhatsapp || null,
        support_phone: v.supportPhone || null,
      })
      .eq("id", true);
    if (error) throw error;
    console.info("[admin] platform settings changed by", user.id);
    revalidatePath("/admin", "layout");
    revalidatePlatform();
    return { ok: true, message: "Saved" };
  } catch (err) {
    return failure(err, "Couldn't save.");
  }
}

const planEditSchema = z.object({
  id: uuid.nullish(),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(300),
  monthlyPrice: z.string().trim().min(1, "Enter the price"),
  maxBranches: z.number().int().min(1).max(1000),
  maxOrdersPerMonth: z.number().int().min(1).nullable(),
  maxBotConversationsPerMonth: z.number().int().min(1).nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
});

export async function savePlanAction(input: z.input<typeof planEditSchema>): Promise<ActionResult> {
  try {
    await requireSuperAdmin();
    const parsed = planEditSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    const price = parseRupees(v.monthlyPrice);
    if (price === null) return { ok: false, error: "Enter a valid price.", fieldErrors: { monthlyPrice: "Like 4999" } };
    const row = {
      name: v.name,
      description: v.description || null,
      monthly_price: price,
      max_branches: v.maxBranches,
      max_orders_per_month: v.maxOrdersPerMonth,
      max_bot_conversations_per_month: v.maxBotConversationsPerMonth,
      is_active: v.isActive,
      sort_order: v.sortOrder,
    };
    const db = createAdminClient();
    const { error } = v.id ? await db.from("plans").update(row).eq("id", v.id) : await db.from("plans").insert(row);
    if (error) {
      if (error.code === "23505") return { ok: false, error: "A plan with this name exists.", fieldErrors: { name: "Already used" } };
      throw error;
    }
    revalidatePath("/admin", "layout");
    revalidatePlatform();
    return { ok: true, message: "Plan saved" };
  } catch (err) {
    return failure(err, "Couldn't save the plan.");
  }
}
