"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import type { Action } from "@/lib/auth/permissions";
import { requirePermission, type CurrentContext } from "@/lib/auth/session";
import { getBranchMenu, type BranchMenu } from "@/lib/menu/pricing";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createOrder,
  editOrder,
  previewOrder,
  recordPayment,
  setOrderHold,
  transitionOrder,
  type Actor,
  type CreatedOrder,
  type EngineDeps,
  type EngineResult,
  type PreviewResult,
  type Scope,
} from "./engine";
import { correctionCandidate, recordCorrection } from "@/lib/bot/corrections";
// Registers WhatsApp order status messages on emitOrderEvent (runs in after()).
import "./notifications";
import {
  getLiveSnapshot,
  getOrderDetail,
  listOrders,
  lookupCustomer,
  type CustomerLookup,
  type LiveSnapshot,
  type OrderDetail,
  type OrderFilters,
} from "./queries";
import type { CartLineInput, CreateOrderInput, EditOrderInput, HoldInput, PaymentInput, TransitionInput } from "./schemas";

type Ctx = { ctx: CurrentContext; deps: EngineDeps; scope: Scope; actor: Actor };

/** Permission check first, then the engine context for this member. */
async function engineFor(action: Action): Promise<Ctx> {
  const ctx = await requirePermission(action);
  return {
    ctx,
    deps: { admin: createAdminClient(), pricing: await createClient() },
    // Only branches this member can access (one, for branch-limited staff).
    scope: { restaurantId: ctx.restaurant.id, branchIds: ctx.branches.map((b) => b.id) },
    actor: { type: "staff", userId: ctx.user.id, role: ctx.role },
  };
}

async function guarded<T>(action: Action, run: (c: Ctx) => Promise<EngineResult<T>>): Promise<EngineResult<T>> {
  try {
    const result = await run(await engineFor(action));
    if (result.ok) revalidatePath("/orders", "layout");
    return result;
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof Error && err.name === "PermissionError") {
      return { ok: false, code: "NOT_ALLOWED", message: "You don't have permission to do this." };
    }
    console.error("[orders] action failed", err);
    return { ok: false, code: "UNKNOWN", message: "Something went wrong. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createOrderAction(input: CreateOrderInput): Promise<EngineResult<CreatedOrder>> {
  return guarded("orders.create", async ({ deps, scope, actor }) => {
    const branchId = z.uuid().safeParse(input.branchId);
    const { data: branch } = branchId.success
      ? await deps.admin.from("branches").select("staff_orders_need_acceptance").eq("id", branchId.data).maybeSingle()
      : { data: null };
    return createOrder(deps, scope, input, actor, {
      initialStatus: branch?.staff_orders_need_acceptance ? "awaiting_acceptance" : "accepted",
    });
  });
}

export async function transitionOrderAction(input: TransitionInput) {
  return guarded("orders.update_status", ({ deps, scope, actor }) => transitionOrder(deps, scope, input, actor));
}

export async function editOrderAction(input: EditOrderInput) {
  return guarded("orders.edit", async ({ ctx, deps, scope, actor }) => {
    // Staff fixing a bot order before accepting it = a lesson for the bot (ai_corrections).
    const orderId = z.uuid().safeParse(input.orderId);
    const watch = orderId.success
      ? await correctionCandidate(deps.admin, ctx.restaurant.id, orderId.data).catch(() => null)
      : null;
    const result = await editOrder(deps, scope, input, actor);
    if (result.ok && watch && orderId.success) {
      await recordCorrection(deps.admin, {
        restaurantId: ctx.restaurant.id,
        orderId: orderId.data,
        sessionId: watch.sessionId,
        before: watch.before,
        editedBy: ctx.user.id,
      }).catch((err) => console.error("[bot] could not save AI correction", err instanceof Error ? err.message : err));
    }
    return result;
  });
}

export async function holdOrderAction(input: HoldInput) {
  return guarded("orders.hold", ({ deps, scope, actor }) => setOrderHold(deps, scope, input, actor));
}

export async function recordPaymentAction(input: PaymentInput) {
  return guarded("payments.record", ({ deps, scope, actor }) => recordPayment(deps, scope, input, actor));
}

export async function setCustomerBlockedAction(input: {
  customerId: string;
  blocked: boolean;
  reason?: string;
}): Promise<EngineResult<null>> {
  return guarded("customers.block", async ({ ctx, deps }) => {
    const parsed = z
      .object({ customerId: z.uuid(), blocked: z.boolean(), reason: z.string().trim().max(300).optional().default("") })
      .safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Please check the details." };
    const v = parsed.data;
    if (v.blocked && !v.reason) {
      return { ok: false, code: "REASON_REQUIRED", message: "Please write why.", fieldErrors: { reason: "Write a reason" } };
    }
    // Blocking isn't writable by users directly (no column grant): server only.
    const { data, error } = await deps.admin
      .from("customers")
      .update({ is_blocked: v.blocked, blocked_reason: v.blocked ? v.reason : null })
      .eq("id", v.customerId)
      .eq("restaurant_id", ctx.restaurant.id)
      .select("id, phone")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, code: "ORDER_NOT_FOUND", message: "Customer not found." };
    await writeAuditLog(await createClient(), {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: v.blocked ? "customer.blocked" : "customer.unblocked",
      entityType: "customer",
      entityId: data.id,
      newData: { reason: v.reason || null },
    });
    revalidatePath("/customers", "layout");
    return { ok: true, data: null };
  });
}

export async function updateCustomerAction(input: {
  customerId: string;
  name: string;
  notes: string;
  tags: string[];
}): Promise<EngineResult<null>> {
  return guarded("customers.edit", async ({ ctx }) => {
    const parsed = z
      .object({
        customerId: z.uuid(),
        name: z.string().trim().max(120, "Name is too long"),
        notes: z.string().trim().max(2000, "Notes are too long"),
        tags: z.array(z.string().trim().min(1).max(30)).max(20),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Please check the details." };
    const v = parsed.data;
    // Runs as the user: RLS + column grants allow only name/notes/tags.
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .update({ name: v.name || null, notes: v.notes || null, tags: v.tags })
      .eq("id", v.customerId)
      .eq("restaurant_id", ctx.restaurant.id)
      .select("id");
    if (error) throw error;
    if (!data?.length) return { ok: false, code: "NOT_ALLOWED", message: "You can't edit this customer." };
    revalidatePath("/customers", "layout");
    return { ok: true, data: null };
  });
}

// ---------------------------------------------------------------------------
// Reads used by client screens
// ---------------------------------------------------------------------------

async function read<T>(action: Action, run: (ctx: CurrentContext) => Promise<T>): Promise<EngineResult<T>> {
  try {
    const ctx = await requirePermission(action);
    return { ok: true, data: await run(ctx) };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[orders] read failed", err);
    return { ok: false, code: "UNKNOWN", message: "Couldn't load. Check your internet and try again." };
  }
}

export async function fetchLiveSnapshotAction(): Promise<EngineResult<LiveSnapshot>> {
  return read("orders.view", getLiveSnapshot);
}

export async function listOrdersAction(filters: OrderFilters) {
  return read("orders.view", (ctx) => listOrders(ctx, filters));
}

export async function getOrderDetailAction(orderId: string): Promise<EngineResult<OrderDetail | null>> {
  if (!z.uuid().safeParse(orderId).success) return { ok: true, data: null };
  return read("orders.view", (ctx) => getOrderDetail(ctx, orderId));
}

export async function lookupCustomerAction(phone: string): Promise<EngineResult<CustomerLookup | null>> {
  return read("orders.create", (ctx) => lookupCustomer(ctx, phone));
}

/** Menu of a branch for the order screen (must be a branch the member can access). */
export async function loadComposerMenuAction(branchId: string): Promise<EngineResult<BranchMenu>> {
  return read("orders.create", async (ctx) => {
    if (!ctx.branches.some((b) => b.id === branchId)) throw new Error("Branch not allowed");
    return getBranchMenu(await createClient(), ctx.restaurant.id, branchId);
  });
}

export async function previewOrderAction(input: {
  branchId: string;
  lines: CartLineInput[];
  deliveryFee?: number;
  discount?: number;
}): Promise<EngineResult<PreviewResult>> {
  try {
    const { deps, scope, actor } = await engineFor("orders.create");
    return await previewOrder(deps, scope, input, actor);
  } catch (err) {
    unstable_rethrow(err);
    console.error("[orders] preview failed", err);
    return { ok: false, code: "UNKNOWN", message: "Couldn't check prices. Check your internet." };
  }
}
