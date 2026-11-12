"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { assignRider, recordCodCollection, transitionOrder, type EngineResult } from "@/lib/orders/engine";
// Registers WhatsApp order status messages on emitOrderEvent ("on the way" with the rider's name).
import "@/lib/orders/notifications";
import { normalizePhone } from "@/lib/orders/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { pinSchema, riderEmail, RIDER_FAIL_REASONS } from "./core";

/**
 * Riders (Phase 9). Management: owner/manager (riders.manage). Assigning:
 * front of house (riders.assign). Rider buttons: the rider themself
 * (deliveries.view) — status changes ALWAYS go through the order engine and
 * the state machine (transition_order_status checks the order is theirs).
 */

const uuid = z.uuid();

function revalidateRiders() {
  revalidatePath("/riders");
  revalidatePath("/rider");
  revalidatePath("/orders", "layout");
}

// ---------------------------------------------------------------------------
// Management
// ---------------------------------------------------------------------------

const addRiderSchema = z.object({
  name: z.string().trim().min(1, "Enter the rider's name").max(80),
  phone: z.string().trim().min(5, "Enter the phone number").max(20),
  branchId: uuid,
  pin: pinSchema,
});

export async function addRiderAction(input: z.input<typeof addRiderSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requirePermission("riders.manage");
    const parsed = addRiderSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    const phone = normalizePhone(v.phone);
    if (!phone) return { ok: false, error: "Phone number is not correct.", fieldErrors: { phone: "Like 0300 1234567" } };
    if (!ctx.branches.some((b) => b.id === v.branchId)) return { ok: false, error: "Choose your branch.", fieldErrors: { branchId: "Choose a branch" } };

    const admin = createAdminClient();
    const { data: existing } = await admin.from("rider_profiles").select("id").eq("phone", phone).maybeSingle();
    if (existing) return { ok: false, error: "This phone number is already a rider.", fieldErrors: { phone: "Already a rider" } };

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: riderEmail(phone),
      password: v.pin,
      email_confirm: true,
      user_metadata: { full_name: v.name },
    });
    if (createError || !created.user) {
      if (createError?.code === "email_exists" || /already/i.test(createError?.message ?? "")) {
        return { ok: false, error: "This phone number already has a rider login.", fieldErrors: { phone: "Already registered" } };
      }
      throw createError ?? new Error("createUser returned no user");
    }
    const userId = created.user.id;
    try {
      await admin.from("profiles").update({ full_name: v.name, phone }).eq("id", userId);
      const { error: mErr } = await admin
        .from("memberships")
        .insert({ user_id: userId, restaurant_id: ctx.restaurant.id, branch_id: v.branchId, role: "rider" });
      if (mErr) throw mErr;
      const { data: rider, error: rErr } = await admin
        .from("rider_profiles")
        .insert({ restaurant_id: ctx.restaurant.id, branch_id: v.branchId, user_id: userId, name: v.name, phone })
        .select("id")
        .single();
      if (rErr) throw rErr;
      await writeAuditLog(await createClient(), {
        restaurantId: ctx.restaurant.id,
        userId: ctx.user.id,
        action: "staff.added",
        entityType: "rider",
        entityId: rider.id,
        newData: { name: v.name, phone, branch_id: v.branchId, role: "rider" },
      });
      revalidateRiders();
      return { ok: true, data: { id: rider.id }, message: "Rider added" };
    } catch (err) {
      await admin.auth.admin.deleteUser(userId); // no orphan login
      throw err;
    }
  } catch (err) {
    return failure(err, "Couldn't add the rider. Please try again.");
  }
}

const updateRiderSchema = z.object({
  riderId: uuid,
  name: z.string().trim().min(1).max(80),
  branchId: uuid,
  isActive: z.boolean(),
});

/** Edit name/branch, or deactivate (a deactivated rider can't log in or see orders). */
export async function updateRiderAction(input: z.input<typeof updateRiderSchema>): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("riders.manage");
    const parsed = updateRiderSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    if (!ctx.branches.some((b) => b.id === v.branchId)) return { ok: false, error: "Choose your branch." };
    const admin = createAdminClient();
    const { data: rider } = await admin
      .from("rider_profiles")
      .select("id, user_id, branch_id, is_active, name")
      .eq("id", v.riderId)
      .eq("restaurant_id", ctx.restaurant.id)
      .maybeSingle();
    if (!rider || !ctx.branches.some((b) => b.id === rider.branch_id)) return { ok: false, error: "Rider not found." };
    const { error } = await admin
      .from("rider_profiles")
      .update({ name: v.name, branch_id: v.branchId, is_active: v.isActive, ...(v.isActive ? {} : { is_online: false }) })
      .eq("id", rider.id);
    if (error) throw error;
    await admin
      .from("memberships")
      .update({ branch_id: v.branchId, is_active: v.isActive })
      .eq("user_id", rider.user_id)
      .eq("restaurant_id", ctx.restaurant.id);
    if (!v.isActive) {
      // Signed out everywhere; unfinished assigned orders go back to the dashboard.
      await admin.auth.admin.signOut(rider.user_id).catch(() => {});
    }
    await writeAuditLog(await createClient(), {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: v.isActive === rider.is_active ? "staff.branch_changed" : v.isActive ? "staff.reactivated" : "staff.deactivated",
      entityType: "rider",
      entityId: rider.id,
      oldData: { name: rider.name, branch_id: rider.branch_id, is_active: rider.is_active },
      newData: { name: v.name, branch_id: v.branchId, is_active: v.isActive },
    });
    revalidateRiders();
    return { ok: true, message: v.isActive ? "Saved" : "Rider switched off" };
  } catch (err) {
    return failure(err, "Couldn't save the rider.");
  }
}

export async function resetRiderPinAction(input: { riderId: string; pin: string }): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("riders.manage");
    const parsed = z.object({ riderId: uuid, pin: pinSchema }).safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const admin = createAdminClient();
    const { data: rider } = await admin
      .from("rider_profiles")
      .select("id, user_id, phone, branch_id")
      .eq("id", parsed.data.riderId)
      .eq("restaurant_id", ctx.restaurant.id)
      .maybeSingle();
    if (!rider || !ctx.branches.some((b) => b.id === rider.branch_id)) return { ok: false, error: "Rider not found." };
    const { error } = await admin.auth.admin.updateUserById(rider.user_id, { password: parsed.data.pin });
    if (error) throw error;
    await admin.from("rider_login_attempts").delete().eq("phone", rider.phone); // unlock
    await writeAuditLog(await createClient(), {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "staff.role_changed",
      entityType: "rider",
      entityId: rider.id,
      newData: { pin_reset: true },
    });
    return { ok: true, message: "New PIN saved" };
  } catch (err) {
    return failure(err, "Couldn't reset the PIN.");
  }
}

// ---------------------------------------------------------------------------
// Assigning (dashboard)
// ---------------------------------------------------------------------------

export async function assignRiderAction(input: { orderId: string; riderId: string | null; expectedVersion: number }): Promise<EngineResult<{ version: number; changed: boolean }>> {
  try {
    const ctx = await requirePermission("riders.assign");
    const result = await assignRider(
      { admin: createAdminClient(), pricing: await createClient() },
      { restaurantId: ctx.restaurant.id, branchIds: ctx.branches.map((b) => b.id) },
      input,
      { type: "staff", userId: ctx.user.id, role: ctx.role },
    );
    if (result.ok) revalidateRiders();
    return result;
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof Error && err.name === "PermissionError") return { ok: false, code: "NOT_ALLOWED", message: "You don't have permission to do this." };
    console.error("[riders] assign failed", err);
    return { ok: false, code: "UNKNOWN", message: "Something went wrong. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// The rider's own buttons
// ---------------------------------------------------------------------------

async function riderContext() {
  const ctx = await requirePermission("deliveries.view");
  const admin = createAdminClient();
  const { data: rider } = await admin
    .from("rider_profiles")
    .select("id, branch_id, is_active")
    .eq("user_id", ctx.user.id)
    .eq("restaurant_id", ctx.restaurant.id)
    .maybeSingle();
  if (!rider?.is_active) throw Object.assign(new Error("Not an active rider"), { name: "PermissionError" });
  return {
    ctx,
    rider,
    deps: { admin, pricing: admin },
    scope: { restaurantId: ctx.restaurant.id, branchIds: [rider.branch_id] },
    actor: { type: "staff" as const, userId: ctx.user.id, role: ctx.role },
  };
}

async function riderGuard<T>(run: (r: Awaited<ReturnType<typeof riderContext>>) => Promise<EngineResult<T>>): Promise<EngineResult<T>> {
  try {
    const r = await riderContext();
    const result = await run(r);
    if (result.ok) revalidateRiders();
    return result;
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof Error && err.name === "PermissionError") return { ok: false, code: "NOT_ALLOWED", message: "This order is not yours." };
    console.error("[riders] action failed", err);
    return { ok: false, code: "UNKNOWN", message: "Something went wrong. Please try again." };
  }
}

/** The order must be assigned to this rider (the RPC checks it again). */
async function ownOrder(r: Awaited<ReturnType<typeof riderContext>>, orderId: string) {
  const { data } = await r.deps.admin
    .from("orders")
    .select("id, rider_id, version, total, payment_status, status")
    .eq("id", orderId)
    .eq("restaurant_id", r.ctx.restaurant.id)
    .maybeSingle();
  return data && data.rider_id === r.rider.id ? data : null;
}

export async function setOnlineAction(isOnline: boolean): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("deliveries.view");
    // User client: RLS + column grant (a rider can only change their own is_online).
    const supabase = await createClient();
    const { data, error } = await supabase.from("rider_profiles").update({ is_online: !!isOnline }).eq("user_id", ctx.user.id).select("id");
    if (error) throw error;
    if (!data.length) return { ok: false, error: "Your rider account is switched off." };
    revalidatePath("/riders");
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't change. Check your internet.");
  }
}

export async function pickedUpAction(input: { orderId: string; expectedVersion: number }) {
  return riderGuard(async (r) => {
    if (!uuid.safeParse(input.orderId).success || !(await ownOrder(r, input.orderId))) {
      return { ok: false, code: "NOT_ALLOWED", message: "This order is not yours." } as const;
    }
    return transitionOrder(r.deps, r.scope, { orderId: input.orderId, expectedVersion: input.expectedVersion, path: ["out_for_delivery"] }, r.actor);
  });
}

const deliveredSchema = z.object({
  orderId: uuid,
  expectedVersion: z.number().int().positive(),
  /** Paisa actually collected (null = already paid, nothing to collect). */
  amount: z.number().int().min(0).max(100_000_000).nullable(),
  reason: z.string().trim().max(300).optional().default(""),
});

export async function deliveredAction(input: z.input<typeof deliveredSchema>) {
  return riderGuard(async (r) => {
    const parsed = deliveredSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Please check the amount." } as const;
    const v = parsed.data;
    const order = await ownOrder(r, v.orderId);
    if (!order) return { ok: false, code: "NOT_ALLOWED", message: "This order is not yours." } as const;
    const needsCash = order.payment_status !== "paid";
    if (needsCash && v.amount === null) return { ok: false, code: "VALIDATION", message: "Enter the cash you collected." } as const;
    if (needsCash && v.amount !== order.total && !v.reason) {
      return { ok: false, code: "REASON_REQUIRED", message: "Write why the amount is different.", fieldErrors: { reason: "Write the reason" } } as const;
    }
    const moved = await transitionOrder(r.deps, r.scope, { orderId: v.orderId, expectedVersion: v.expectedVersion, path: ["delivered"] }, r.actor);
    if (!moved.ok || !needsCash) return moved;
    const cash = await recordCodCollection(r.deps, r.scope, { orderId: v.orderId, amount: v.amount!, note: v.reason }, r.actor);
    return cash.ok ? { ok: true, data: { status: moved.data.status, version: cash.data.version } } : cash;
  });
}

const failedSchema = z.object({
  orderId: uuid,
  expectedVersion: z.number().int().positive(),
  reason: z.enum(RIDER_FAIL_REASONS.map((r) => r.value) as [string, ...string[]]),
  note: z.string().trim().max(300).optional().default(""),
});

export async function deliveryFailedAction(input: z.input<typeof failedSchema>) {
  return riderGuard(async (r) => {
    const parsed = failedSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "REASON_REQUIRED", message: "Choose a reason." } as const;
    const v = parsed.data;
    if (!(await ownOrder(r, v.orderId))) return { ok: false, code: "NOT_ALLOWED", message: "This order is not yours." } as const;
    return transitionOrder(
      r.deps,
      r.scope,
      { orderId: v.orderId, expectedVersion: v.expectedVersion, path: ["failed"], reason: v.reason, note: v.note },
      r.actor,
    );
  });
}

// ---------------------------------------------------------------------------
// Settling cash
// ---------------------------------------------------------------------------

const settleSchema = z.object({
  riderId: uuid,
  orderIds: z.array(uuid).min(1, "Nothing to settle").max(500),
  amount: z.number().int().min(0).max(1_000_000_000),
  notes: z.string().trim().max(300).optional().default(""),
});

export async function settleRiderCashAction(input: z.input<typeof settleSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requirePermission("riders.manage");
    const parsed = settleSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    const admin = createAdminClient();
    const { data: rider } = await admin.from("rider_profiles").select("id, branch_id").eq("id", v.riderId).eq("restaurant_id", ctx.restaurant.id).maybeSingle();
    if (!rider || !ctx.branches.some((b) => b.id === rider.branch_id)) return { ok: false, error: "Rider not found." };
    const { data, error } = await admin.rpc("settle_rider_cash", {
      p_restaurant_id: ctx.restaurant.id,
      p_rider_id: v.riderId,
      p_order_ids: v.orderIds,
      p_amount: v.amount,
      p_settled_by: ctx.user.id,
      p_notes: v.notes,
    });
    if (error) {
      const token = error.message.trim();
      if (token === "REASON_REQUIRED") return { ok: false, error: "The amount is different. Write a note.", fieldErrors: { notes: "Write why" } };
      if (token === "ALREADY_SETTLED") return { ok: false, error: "Some of this cash was already settled. Refresh the page." };
      throw error;
    }
    revalidateRiders();
    return { ok: true, data: { id: (data as { id: string }).id }, message: "Cash settled" };
  } catch (err) {
    return failure(err, "Couldn't settle the cash.");
  }
}
