/**
 * Order engine: the ONLY code that writes orders.
 *
 * - Every price comes from the pricing engine (resolveCart / computeOrderTotals).
 * - Writes go through service-role-only Postgres RPCs (create_order,
 *   transition_order_status, edit_order, set_order_hold, record_payment), so
 *   nobody can insert an order or change a total from a browser.
 * - Callers (server actions, the WhatsApp webhook later, scripts) MUST check
 *   the user's permission first and pass the branches they may touch.
 * - After each change, emitOrderEvent() runs (notifications hook).
 *
 * No Next.js imports on purpose: scripts and tests run the same engine.
 */
import { z } from "zod";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { can, type Role } from "@/lib/auth/permissions";
import {
  computeOrderTotals,
  resolveCart,
  type PricingError,
  type ResolvedCartItem,
} from "@/lib/menu/pricing";
import type { Database, Json } from "@/types/database";
import type { OrderStatus } from "./constants";
import { emitOrderEvent } from "./events";
import { normalizePhone } from "./phone";
import {
  createOrderSchema,
  editOrderSchema,
  holdSchema,
  paymentSchema,
  transitionSchema,
  type CartLineInput,
  type CreateOrderInput,
  type EditOrderInput,
  type HoldInput,
  type PaymentInput,
  type TransitionInput,
} from "./schemas";
import { CANCEL_REASONS, FAIL_REASONS, canEdit, canTransitionPath, reasonNeedsNote } from "./status";

type Db = SupabaseClient<Database>;

export type EngineDeps = {
  /** Service-role client: runs the write RPCs. */
  admin: Db;
  /** Client used to read menu prices (user's RLS client, or admin for bots). */
  pricing: Db;
  /** Override for tests. */
  resolve?: typeof resolveCart;
};

export type Actor = {
  type: "staff" | "bot" | "system" | "customer";
  userId: string | null;
  role: Role | null;
};

export type Scope = {
  restaurantId: string;
  /** Branches the actor may touch; null = any branch of the restaurant (bot/system). */
  branchIds: string[] | null;
};

export type OrderErrorCode =
  | "VALIDATION"
  | "PRICING_FAILED"
  | "INVALID_PHONE"
  | "CUSTOMER_BLOCKED"
  | "NOT_ALLOWED"
  | "DISCOUNT_TOO_HIGH"
  | "ORDER_NOT_FOUND"
  | "BRANCH_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "VERSION_CONFLICT"
  | "NOT_EDITABLE"
  | "ON_HOLD"
  | "REASON_REQUIRED"
  | "ALREADY_PAID"
  | "NOT_ASSIGNABLE"
  | "RIDER_NOT_FOUND"
  | "ALREADY_SETTLED"
  | "INVALID_AMOUNT"
  | "UNKNOWN";

export type LineErrors = { index: number; errors: PricingError[] }[];

export type EngineResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: OrderErrorCode;
      message: string;
      fieldErrors?: Record<string, string>;
      lineErrors?: LineErrors;
    };

const fail = <T>(code: OrderErrorCode, message: string, extra?: Partial<Extract<EngineResult<T>, { ok: false }>>): EngineResult<T> => ({
  ok: false,
  code,
  message,
  ...extra,
});

const MESSAGES: Partial<Record<OrderErrorCode, string>> = {
  VERSION_CONFLICT: "This order was already updated by someone else. We've refreshed it.",
  INVALID_TRANSITION: "This order can't move to that step.",
  NOT_EDITABLE: "This order can't be changed anymore.",
  ON_HOLD: "This order is on hold. Release it first.",
  CUSTOMER_BLOCKED: "This customer is blocked.",
  ORDER_NOT_FOUND: "This order no longer exists.",
  BRANCH_NOT_FOUND: "This branch isn't taking orders.",
  REASON_REQUIRED: "Please choose a reason.",
  ALREADY_PAID: "This order is already marked as paid.",
  NOT_ALLOWED: "You don't have permission to do this.",
  NOT_ASSIGNABLE: "Riders can only be given delivery orders that aren't finished.",
  RIDER_NOT_FOUND: "This rider isn't active at this branch.",
  ALREADY_SETTLED: "This cash was already settled.",
  INVALID_AMOUNT: "Please enter a valid amount.",
};

/** Map an RPC error (message = stable token) to an engine error. */
function fromRpcError<T>(error: PostgrestError): EngineResult<T> {
  const token = error.message.trim();
  const map: Record<string, OrderErrorCode> = {
    VERSION_CONFLICT: "VERSION_CONFLICT",
    INVALID_TRANSITION: "INVALID_TRANSITION",
    NOT_EDITABLE: "NOT_EDITABLE",
    ON_HOLD: "ON_HOLD",
    CUSTOMER_BLOCKED: "CUSTOMER_BLOCKED",
    ROLE_NOT_ALLOWED: "NOT_ALLOWED",
    REASON_REQUIRED: "REASON_REQUIRED",
    ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
    BRANCH_NOT_FOUND: "BRANCH_NOT_FOUND",
    ALREADY_PAID: "ALREADY_PAID",
    NO_ITEMS: "VALIDATION",
    NOT_ASSIGNABLE: "NOT_ASSIGNABLE",
    RIDER_NOT_FOUND: "RIDER_NOT_FOUND",
    ALREADY_SETTLED: "ALREADY_SETTLED",
    INVALID_AMOUNT: "INVALID_AMOUNT",
  };
  const code = map[token];
  if (code) return fail(code, MESSAGES[code] ?? "Please check the order.");
  console.error("[orders] rpc error", error);
  return fail("UNKNOWN", "Something went wrong. Please try again.");
}

function zodFields(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

function branchAllowed(scope: Scope, branchId: string) {
  return scope.branchIds === null || scope.branchIds.includes(branchId);
}

/** Max discount for a role, as % of the items total. */
export function maxDiscountPercent(role: Role | null) {
  return role === "owner" ? 100 : 50;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

type ParsedLine = { itemId: string; variantId?: string | null; optionIds: string[]; removals: string[]; quantity: number; notes: string };

async function priceLines(deps: EngineDeps, restaurantId: string, branchId: string, lines: ParsedLine[]) {
  const resolver = deps.resolve ?? resolveCart;
  const result = await resolver(
    deps.pricing,
    lines.map((l) => ({
      restaurantId,
      branchId,
      itemId: l.itemId,
      variantId: l.variantId ?? null,
      modifierOptionIds: l.optionIds,
      removals: l.removals,
      quantity: l.quantity,
    })),
  );
  const lineErrors: LineErrors = [];
  const priced: ResolvedCartItem[] = [];
  result.results.forEach((r, index) => {
    if (r.ok) priced.push(r.line);
    else lineErrors.push({ index, errors: r.errors });
  });
  return { priced, lineErrors };
}

function itemsPayload(priced: ResolvedCartItem[], lines: ParsedLine[]) {
  return priced.map((p, i) => ({
    item_id: p.itemId,
    variant_id: p.variantId,
    item_name: p.itemName,
    size_name: p.sizeName,
    quantity: p.quantity,
    unit_price: p.unitPrice,
    line_total: p.lineTotal,
    removals: p.removals,
    notes: lines[i].notes,
    snapshot: p.snapshot as unknown as Json,
    modifiers: p.options.map((o) => ({
      option_id: o.id,
      group_name: o.groupName,
      option_name: o.name,
      price_delta: o.priceDelta,
    })),
  }));
}

function checkDiscount<T>(discount: number, actor: Actor): EngineResult<T> | null {
  if (discount > 0 && actor.type === "staff" && !can(actor.role, "orders.discount")) {
    return fail("NOT_ALLOWED", "Only a manager can give a discount.", { fieldErrors: { discount: "Not allowed" } });
  }
  return null;
}

export type PreviewResult = {
  lines: ({ ok: true; line: ResolvedCartItem } | { ok: false; errors: PricingError[] })[];
  totals: ReturnType<typeof computeOrderTotals> | null;
};

/** Live cart totals for the order screen. Same engine, nothing saved. */
export async function previewOrder(
  deps: EngineDeps,
  scope: Scope,
  input: { branchId: string; lines: CartLineInput[]; deliveryFee?: number; discount?: number },
  actor: Actor,
): Promise<EngineResult<PreviewResult>> {
  if (!branchAllowed(scope, input.branchId)) return fail("NOT_ALLOWED", "You can't take orders for this branch.");
  const resolver = deps.resolve ?? resolveCart;
  const result = await resolver(
    deps.pricing,
    input.lines.map((l) => ({
      restaurantId: scope.restaurantId,
      branchId: input.branchId,
      itemId: l.itemId,
      variantId: l.variantId ?? null,
      modifierOptionIds: l.optionIds ?? [],
      removals: l.removals ?? [],
      quantity: l.quantity,
    })),
  );
  const okLines = result.results.flatMap((r) => (r.ok ? [r.line] : []));
  return {
    ok: true,
    data: {
      lines: result.results,
      totals: result.ok
        ? computeOrderTotals({
            lines: okLines,
            deliveryFee: input.deliveryFee ?? 0,
            discount: input.discount ?? 0,
            maxDiscountPercent: maxDiscountPercent(actor.role),
          })
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreatedOrder = { id: string; orderNumber: number; duplicate: boolean };

export async function createOrder(
  deps: EngineDeps,
  scope: Scope,
  rawInput: CreateOrderInput,
  actor: Actor,
  options: { initialStatus?: OrderStatus } = {},
): Promise<EngineResult<CreatedOrder>> {
  const parsed = createOrderSchema.safeParse(rawInput);
  if (!parsed.success) return fail("VALIDATION", "Please check the order.", { fieldErrors: zodFields(parsed.error) });
  const input = parsed.data;

  if (!branchAllowed(scope, input.branchId)) return fail("NOT_ALLOWED", "You can't take orders for this branch.");

  let phone: string | null = null;
  if (input.customer.phone) {
    phone = normalizePhone(input.customer.phone);
    if (!phone) {
      return fail("INVALID_PHONE", "This phone number doesn't look right.", {
        fieldErrors: { "customer.phone": "Use a number like 0300-1234567" },
      });
    }
  }

  const discountProblem = checkDiscount<CreatedOrder>(input.discount, actor);
  if (discountProblem) return discountProblem;

  const { priced, lineErrors } = await priceLines(deps, scope.restaurantId, input.branchId, input.lines);
  if (lineErrors.length) return fail("PRICING_FAILED", "Some items need attention.", { lineErrors });

  const totals = computeOrderTotals({
    lines: priced,
    deliveryFee: input.deliveryFee,
    discount: input.discount,
    maxDiscountPercent: maxDiscountPercent(actor.role),
  });
  if (!totals.ok) {
    return fail(totals.error.code === "DISCOUNT_TOO_HIGH" ? "DISCOUNT_TOO_HIGH" : "VALIDATION", totals.error.message, {
      fieldErrors: { discount: totals.error.message },
    });
  }

  // Blocked customers: stop, unless a permitted staff member overrides with a reason.
  let overrideBlock = false;
  if (phone) {
    const { data: existing } = await deps.admin
      .from("customers")
      .select("id, is_blocked, blocked_reason")
      .eq("restaurant_id", scope.restaurantId)
      .eq("phone", phone)
      .maybeSingle();
    if (existing?.is_blocked) {
      if (!input.overrideBlockReason) {
        return fail("CUSTOMER_BLOCKED", `This customer is blocked${existing.blocked_reason ? `: ${existing.blocked_reason}` : ""}.`);
      }
      if (actor.type === "staff" && !can(actor.role, "orders.override_block")) {
        return fail("NOT_ALLOWED", "Only a manager can take orders from a blocked customer.");
      }
      overrideBlock = true;
    }
  }

  const status: OrderStatus = options.initialStatus ?? "accepted";
  const t = totals.totals;
  const { data, error } = await deps.admin.rpc("create_order", {
    p: {
      restaurant_id: scope.restaurantId,
      branch_id: input.branchId,
      idempotency_key: input.idempotencyKey,
      status,
      order_type: input.orderType,
      source: input.source,
      payment_method: input.paymentMethod,
      actor_type: actor.type,
      actor_user_id: actor.userId,
      override_block: overrideBlock,
      customer: phone ? { phone, name: input.customer.name } : null,
      customer_name: input.customer.name,
      address:
        input.orderType === "delivery" && input.address
          ? {
              address_text: input.address.addressText,
              area: input.address.area,
              landmark: input.address.landmark,
              label: input.address.label,
              latitude: input.address.latitude ?? null,
              longitude: input.address.longitude ?? null,
              save: input.address.save,
            }
          : null,
      table_number: input.orderType === "dine_in" ? input.tableNumber : "",
      notes: input.notes,
      subtotal: t.subtotal,
      delivery_fee: t.deliveryFee,
      discount: t.discount,
      tax: t.tax,
      service_charge: t.serviceCharge,
      total: t.total,
      items: itemsPayload(priced, input.lines),
    },
  });
  if (error) return fromRpcError(error);

  const result = data as { id: string; order_number: number; duplicate: boolean };
  if (!result.duplicate) {
    if (overrideBlock) {
      await deps.admin.from("audit_logs").insert({
        restaurant_id: scope.restaurantId,
        user_id: actor.userId,
        action: "order.blocked_customer_override",
        entity_type: "order",
        entity_id: result.id,
        new_data: { phone, reason: input.overrideBlockReason },
      });
    }
    await emitOrderEvent(
      { id: result.id, restaurantId: scope.restaurantId, branchId: input.branchId, orderNumber: result.order_number },
      { kind: "created", to: status, actor },
    );
  }
  return { ok: true, data: { id: result.id, orderNumber: result.order_number, duplicate: result.duplicate } };
}

// ---------------------------------------------------------------------------
// Load (for permission checks before writing)
// ---------------------------------------------------------------------------

async function loadOrder(deps: EngineDeps, scope: Scope, orderId: string) {
  const { data } = await deps.admin
    .from("orders")
    .select("id, restaurant_id, branch_id, order_number, status, order_type, is_on_hold, version, total, payment_status")
    .eq("id", orderId)
    .eq("restaurant_id", scope.restaurantId)
    .maybeSingle();
  if (!data || !branchAllowed(scope, data.branch_id)) return null;
  return data;
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

export async function transitionOrder(
  deps: EngineDeps,
  scope: Scope,
  rawInput: TransitionInput,
  actor: Actor,
): Promise<EngineResult<{ status: OrderStatus; version: number }>> {
  const parsed = transitionSchema.safeParse(rawInput);
  if (!parsed.success) return fail("VALIDATION", "Please check the details.", { fieldErrors: zodFields(parsed.error) });
  const input = parsed.data;

  const order = await loadOrder(deps, scope, input.orderId);
  if (!order) return fail("ORDER_NOT_FOUND", MESSAGES.ORDER_NOT_FOUND!);
  if (order.version !== input.expectedVersion) return fail("VERSION_CONFLICT", MESSAGES.VERSION_CONFLICT!);

  if (actor.type === "staff") {
    const check = canTransitionPath({
      from: order.status,
      path: input.path,
      orderType: order.order_type,
      role: actor.role,
      isOnHold: order.is_on_hold,
    });
    if (!check.ok) return fail(check.code === "ROLE_NOT_ALLOWED" ? "NOT_ALLOWED" : check.code, check.message);
  }

  const last = input.path[input.path.length - 1];
  if (last === "cancelled" || last === "failed") {
    const allowed = (last === "cancelled" ? CANCEL_REASONS : FAIL_REASONS).map((r) => r.value as string);
    if (!allowed.includes(input.reason)) {
      return fail("REASON_REQUIRED", "Please choose a reason.", { fieldErrors: { reason: "Choose a reason" } });
    }
    if (reasonNeedsNote(input.reason) && !input.note) {
      return fail("REASON_REQUIRED", "Please write the reason.", { fieldErrors: { note: "Write the reason" } });
    }
  }

  const { data, error } = await deps.admin.rpc("transition_order_status", {
    p_restaurant_id: scope.restaurantId,
    p_order_id: order.id,
    p_expected_version: input.expectedVersion,
    p_path: input.path,
    p_actor_type: actor.type,
    p_actor_user_id: actor.userId ?? undefined,
    p_reason: input.reason || undefined,
    p_note: input.note || undefined,
  });
  if (error) return fromRpcError(error);

  const result = data as { status: OrderStatus; version: number };
  await emitOrderEvent(
    { id: order.id, restaurantId: scope.restaurantId, branchId: order.branch_id, orderNumber: order.order_number },
    {
      kind: last === "cancelled" ? "cancelled" : "status_changed",
      from: order.status,
      to: result.status,
      actor,
      data: input.reason ? { reason: input.reason } : undefined,
    },
  );
  return { ok: true, data: result };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export async function editOrder(
  deps: EngineDeps,
  scope: Scope,
  rawInput: EditOrderInput,
  actor: Actor,
): Promise<EngineResult<{ version: number; kitchenAlert: boolean }>> {
  const parsed = editOrderSchema.safeParse(rawInput);
  if (!parsed.success) return fail("VALIDATION", "Please check the order.", { fieldErrors: zodFields(parsed.error) });
  const input = parsed.data;

  const order = await loadOrder(deps, scope, input.orderId);
  if (!order) return fail("ORDER_NOT_FOUND", MESSAGES.ORDER_NOT_FOUND!);
  if (order.version !== input.expectedVersion) return fail("VERSION_CONFLICT", MESSAGES.VERSION_CONFLICT!);
  const editCheck = canEdit(order.status, actor.role);
  if (!editCheck.ok) return fail("NOT_EDITABLE", editCheck.message);

  const discountProblem = checkDiscount<{ version: number; kitchenAlert: boolean }>(input.discount, actor);
  if (discountProblem) return discountProblem;

  const { priced, lineErrors } = await priceLines(deps, scope.restaurantId, order.branch_id, input.lines);
  if (lineErrors.length) return fail("PRICING_FAILED", "Some items need attention.", { lineErrors });

  const totals = computeOrderTotals({
    lines: priced,
    deliveryFee: input.deliveryFee,
    discount: input.discount,
    maxDiscountPercent: maxDiscountPercent(actor.role),
  });
  if (!totals.ok) return fail("DISCOUNT_TOO_HIGH", totals.error.message, { fieldErrors: { discount: totals.error.message } });
  const t = totals.totals;

  const { data, error } = await deps.admin.rpc("edit_order", {
    p: {
      restaurant_id: scope.restaurantId,
      order_id: order.id,
      expected_version: input.expectedVersion,
      actor_user_id: actor.userId,
      items: itemsPayload(priced, input.lines),
      subtotal: t.subtotal,
      delivery_fee: t.deliveryFee,
      discount: t.discount,
      tax: t.tax,
      service_charge: t.serviceCharge,
      total: t.total,
      order_type: input.orderType,
      payment_method: input.paymentMethod,
      notes: input.notes,
      table_number: input.orderType === "dine_in" ? input.tableNumber : "",
      address:
        input.orderType === "delivery" && input.address
          ? { address_text: input.address.addressText, area: input.address.area, landmark: input.address.landmark }
          : { address_text: "", area: "", landmark: "" },
    },
  });
  if (error) return fromRpcError(error);

  const result = data as { version: number; kitchen_alert: boolean };
  await emitOrderEvent(
    { id: order.id, restaurantId: scope.restaurantId, branchId: order.branch_id, orderNumber: order.order_number },
    { kind: "edited", actor, data: { kitchenAlert: result.kitchen_alert } },
  );
  return { ok: true, data: { version: result.version, kitchenAlert: result.kitchen_alert } };
}

// ---------------------------------------------------------------------------
// Hold / payment
// ---------------------------------------------------------------------------

export async function setOrderHold(
  deps: EngineDeps,
  scope: Scope,
  rawInput: HoldInput,
  actor: Actor,
): Promise<EngineResult<{ version: number }>> {
  const parsed = holdSchema.safeParse(rawInput);
  if (!parsed.success) return fail("VALIDATION", "Please check the details.", { fieldErrors: zodFields(parsed.error) });
  const input = parsed.data;
  if (actor.type === "staff" && !can(actor.role, "orders.hold")) return fail("NOT_ALLOWED", MESSAGES.NOT_ALLOWED!);
  if (input.hold && !input.reason) {
    return fail("REASON_REQUIRED", "Please write why this order is on hold.", { fieldErrors: { reason: "Write a reason" } });
  }
  const order = await loadOrder(deps, scope, input.orderId);
  if (!order) return fail("ORDER_NOT_FOUND", MESSAGES.ORDER_NOT_FOUND!);

  const { data, error } = await deps.admin.rpc("set_order_hold", {
    p_restaurant_id: scope.restaurantId,
    p_order_id: order.id,
    p_expected_version: input.expectedVersion,
    p_hold: input.hold,
    p_reason: input.reason,
    p_actor_user_id: actor.userId!,
  });
  if (error) return fromRpcError(error);
  await emitOrderEvent(
    { id: order.id, restaurantId: scope.restaurantId, branchId: order.branch_id, orderNumber: order.order_number },
    { kind: input.hold ? "held" : "unheld", actor, data: { reason: input.reason } },
  );
  return { ok: true, data: { version: (data as { version: number }).version } };
}

export async function recordPayment(
  deps: EngineDeps,
  scope: Scope,
  rawInput: PaymentInput,
  actor: Actor,
): Promise<EngineResult<{ version: number }>> {
  const parsed = paymentSchema.safeParse(rawInput);
  if (!parsed.success) return fail("VALIDATION", "Please check the details.", { fieldErrors: zodFields(parsed.error) });
  const input = parsed.data;
  if (actor.type === "staff" && !can(actor.role, "payments.record")) return fail("NOT_ALLOWED", MESSAGES.NOT_ALLOWED!);
  if ((input.method === "bank_transfer" || input.method === "online_link") && !input.reference) {
    return fail("VALIDATION", "Enter the transaction ID from the transfer.", {
      fieldErrors: { reference: "Enter the transaction ID" },
    });
  }
  const order = await loadOrder(deps, scope, input.orderId);
  if (!order) return fail("ORDER_NOT_FOUND", MESSAGES.ORDER_NOT_FOUND!);

  const { data, error } = await deps.admin.rpc("record_payment", {
    p_restaurant_id: scope.restaurantId,
    p_order_id: order.id,
    p_method: input.method,
    // Amount is the order's own total from the database, never typed in.
    p_amount: order.total,
    p_reference: input.reference,
    p_actor_user_id: actor.userId!,
  });
  if (error) return fromRpcError(error);
  await emitOrderEvent(
    { id: order.id, restaurantId: scope.restaurantId, branchId: order.branch_id, orderNumber: order.order_number },
    { kind: "payment_updated", actor, data: { method: input.method } },
  );
  return { ok: true, data: { version: (data as { version: number }).version } };
}

// ---------------------------------------------------------------------------
// Riders (Phase 9)
// ---------------------------------------------------------------------------

const assignSchema = z.object({
  orderId: z.uuid(),
  riderId: z.uuid().nullable(),
  expectedVersion: z.number().int().positive(),
});

/** Assign, reassign (another rider) or unassign (riderId null) a delivery order. */
export async function assignRider(
  deps: EngineDeps,
  scope: Scope,
  rawInput: z.input<typeof assignSchema>,
  actor: Actor,
): Promise<EngineResult<{ version: number; changed: boolean }>> {
  const parsed = assignSchema.safeParse(rawInput);
  if (!parsed.success) return fail("VALIDATION", "Please check the details.", { fieldErrors: zodFields(parsed.error) });
  const input = parsed.data;
  if (actor.type === "staff" && !can(actor.role, "riders.assign")) return fail("NOT_ALLOWED", MESSAGES.NOT_ALLOWED!);
  const order = await loadOrder(deps, scope, input.orderId);
  if (!order) return fail("ORDER_NOT_FOUND", MESSAGES.ORDER_NOT_FOUND!);
  if (order.version !== input.expectedVersion) return fail("VERSION_CONFLICT", MESSAGES.VERSION_CONFLICT!);

  const { data, error } = await deps.admin.rpc("assign_order_rider", {
    p_restaurant_id: scope.restaurantId,
    p_order_id: order.id,
    p_rider_id: input.riderId as string,
    p_expected_version: input.expectedVersion,
    p_actor_user_id: actor.userId as string,
  });
  if (error) return fromRpcError(error);
  const result = data as { version: number; changed: boolean };
  if (result.changed) {
    await emitOrderEvent(
      { id: order.id, restaurantId: scope.restaurantId, branchId: order.branch_id, orderNumber: order.order_number },
      { kind: input.riderId ? "rider_assigned" : "rider_unassigned", actor, data: { riderId: input.riderId } },
    );
  }
  return { ok: true, data: result };
}

const codSchema = z.object({
  orderId: z.uuid(),
  amount: z.number().int("Use whole rupees").min(0).max(100_000_000),
  note: z.string().trim().max(300).optional().default(""),
});

/** Cash the rider collected on a delivered order (a different amount needs a reason). */
export async function recordCodCollection(
  deps: EngineDeps,
  scope: Scope,
  rawInput: z.input<typeof codSchema>,
  actor: Actor,
): Promise<EngineResult<{ version: number }>> {
  const parsed = codSchema.safeParse(rawInput);
  if (!parsed.success) return fail("VALIDATION", "Please check the amount.", { fieldErrors: zodFields(parsed.error) });
  const input = parsed.data;
  const order = await loadOrder(deps, scope, input.orderId);
  if (!order) return fail("ORDER_NOT_FOUND", MESSAGES.ORDER_NOT_FOUND!);
  if (input.amount !== order.total && !input.note) {
    return fail("REASON_REQUIRED", "Write why the amount is different.", { fieldErrors: { note: "Write the reason" } });
  }
  const { data, error } = await deps.admin.rpc("record_cod_collection", {
    p_restaurant_id: scope.restaurantId,
    p_order_id: order.id,
    p_amount: input.amount,
    p_note: input.note,
    p_actor_user_id: actor.userId as string,
  });
  if (error) return fromRpcError(error);
  await emitOrderEvent(
    { id: order.id, restaurantId: scope.restaurantId, branchId: order.branch_id, orderNumber: order.order_number },
    { kind: "cash_collected", actor, data: { amount: input.amount } },
  );
  return { ok: true, data: { version: (data as { version: number }).version } };
}
