import { z } from "zod";
import { BOT_LIMITS } from "../config";
import { buildSummary, cartSubtotal, hasAddress, invalidateSummary, missingFields, repriceCart, summaryHash } from "../cart";
import { money } from "../menu-index";
import { t } from "../texts";
import { applyDeliveryZone, deliveryTerms } from "../delivery";
import { fail, type BotContext, type ToolResult } from "./context";

const optStr = (max: number) => z.string().trim().max(max).nullish();

export const orderTypeSchema = z.object({ order_type: z.enum(["delivery", "pickup"]) });
export const addressSchema = z.object({
  address_text: z.string().trim().min(3).max(500).describe("House/street/block as the customer wrote it"),
  area: optStr(80).describe("Area / sector, e.g. 'DHA Phase 5'"),
  landmark: optStr(200).describe("A nearby landmark, e.g. 'near Imtiaz store'"),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
});
export const paymentSchema = z.object({ payment_method: z.enum(["cod", "card_on_delivery"]) });
export const nameSchema = z.object({ name: z.string().trim().min(2).max(60) });
export const reasonSchema = z.object({ reason: z.string().trim().min(2).max(300) });

const next = (ctx: BotContext) => ({ still_needed: missingFields(ctx.session, ctx.customer) });

export async function setOrderTypeTool(ctx: BotContext, input: z.infer<typeof orderTypeSchema>): Promise<ToolResult> {
  ctx.session.orderType = input.order_type;
  invalidateSummary(ctx.session);
  return {
    ok: true,
    order_type: input.order_type,
    ...(input.order_type === "delivery"
      ? ctx.session.deliveryZone && ctx.session.deliveryZone.status !== "out_of_range"
        ? { delivery_fee: money(deliveryTerms(ctx.session, ctx.branch).fee), note: "Fee for the customer's area (already known)." }
        : { delivery_fee: "depends on the area — ask for the address first" }
      : { pickup_from: [ctx.branch.name, ctx.branch.address].filter(Boolean).join(", ") }),
    ...next(ctx),
  };
}

export async function setDeliveryAddressTool(ctx: BotContext, input: z.infer<typeof addressSchema>): Promise<ToolResult> {
  const s = ctx.session;
  s.orderType = "delivery";
  // A "landmark" that just repeats the address or area is not a landmark.
  const lm = input.landmark?.trim() ?? "";
  const norm = (x: string | null | undefined) => (x ?? "").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim();
  const landmark = lm && !norm(input.address_text).includes(norm(lm)) && norm(lm) !== norm(input.area) ? lm : null;
  s.address = {
    text: input.address_text,
    area: input.area?.trim() || s.address.area,
    landmark,
    latitude: input.latitude ?? s.address.latitude,
    longitude: input.longitude ?? s.address.longitude,
  };
  invalidateSummary(s);
  // Delivery zone (Phase 9): code decides the fee and minimum from the area / pin.
  const zone = await applyDeliveryZone(ctx);
  if (zone?.status === "out_of_range") {
    return fail("OUT_OF_RANGE", "We don't deliver to this area.", {
      say: "Maazrat, is area mein delivery nahi hoti. Kya aap pickup karna chahenge?",
      instruction: "Tell the customer exactly that (in their language) and offer pickup. Do not take delivery for this address.",
      pickup_from: [ctx.branch.name, ctx.branch.address].filter(Boolean).join(", "),
    });
  }
  const terms = deliveryTerms(s, ctx.branch);
  const subtotal = cartSubtotal(s.cart);
  const area = {
    delivery_area: zone?.name ?? s.address.area ?? null,
    delivery_fee: money(terms.fee),
    ...(terms.minimumOrder ? { minimum_order: money(terms.minimumOrder) } : {}),
    ...(terms.minimumOrder > subtotal && s.cart.length ? { below_minimum_by: money(terms.minimumOrder - subtotal) } : {}),
    ...(zone?.etaMinutes ? { delivery_time: `about ${zone.etaMinutes} minutes` } : {}),
  };
  if (!hasAddress(s)) {
    return fail("LANDMARK_REQUIRED", "Address saved, but riders need a nearby landmark or a location pin. Ask for one.", { ...area, ...next(ctx) });
  }
  return { ok: true, address: [s.address.text, s.address.area, s.address.landmark].filter(Boolean).join(", "), ...area, ...next(ctx) };
}

export async function setPaymentMethodTool(ctx: BotContext, input: z.infer<typeof paymentSchema>): Promise<ToolResult> {
  if (!ctx.restaurant.paymentMethods.includes(input.payment_method)) {
    return fail("PAYMENT_NOT_ACCEPTED", "This restaurant doesn't accept that payment method.", {
      accepted: ctx.restaurant.paymentMethods.map((m) => (m === "cod" ? "cash on delivery" : "card on delivery")),
    });
  }
  ctx.session.paymentMethod = input.payment_method;
  invalidateSummary(ctx.session);
  return { ok: true, payment_method: input.payment_method, ...next(ctx) };
}

export async function setCustomerNameTool(ctx: BotContext, input: z.infer<typeof nameSchema>): Promise<ToolResult> {
  if (!ctx.customer) return fail("NO_CUSTOMER", "Customer record is missing. Hand off to staff.");
  await ctx.store.setCustomerName(ctx.session.restaurantId, ctx.customer.id, input.name);
  ctx.customer = { ...ctx.customer, name: input.name };
  invalidateSummary(ctx.session);
  return { ok: true, name: input.name, ...next(ctx) };
}

/**
 * Checks everything; when ready, CODE builds the summary text (the agent
 * sends it word for word) and the confirm/change/cancel buttons are shown.
 */
export async function showOrderSummaryTool(ctx: BotContext): Promise<ToolResult> {
  const s = ctx.session;
  if (!ctx.branch.isOpenNow) {
    return fail("BRANCH_CLOSED", "The restaurant is closed right now. Do not take the order.", { today_hours: ctx.branch.todayHours });
  }
  const problems = await repriceCart(ctx.store, s);
  if (problems.length) {
    return fail("ITEM_PROBLEM", "Some items can't be ordered as they are. Fix or remove these lines first.", {
      problems: problems.map((p) => ({ line_id: p.lineId, item: p.name, error: p.errors[0]?.code, message: p.errors[0]?.message })),
    });
  }
  if (s.orderType === "delivery" && s.deliveryZone?.status === "out_of_range") {
    return fail("OUT_OF_RANGE", "We don't deliver to this address. Say \"Maazrat, is area mein delivery nahi hoti\" and offer pickup.");
  }
  const missing: string[] = missingFields(s, ctx.customer);
  const subtotal = cartSubtotal(s.cart);
  const terms = deliveryTerms(s, ctx.branch);
  if (s.orderType === "delivery" && terms.minimumOrder > subtotal) missing.push("minimum_order");
  if (missing.length || !ctx.customer) {
    return fail("NOT_READY", "Ask the customer for the first missing thing (one question).", {
      missing,
      ...(missing.includes("minimum_order")
        ? {
            minimum_order: money(terms.minimumOrder),
            current_subtotal: money(subtotal),
            add_at_least: money(terms.minimumOrder - subtotal),
            instruction: "Tell the customer the minimum for their area and how much more to add (add_at_least).",
          }
        : {}),
    });
  }

  const summary = buildSummary(s, ctx.branch, ctx.customer);
  s.summaryHash = summaryHash(s, summary.deliveryFee, summary.customerName);
  s.status = "awaiting_confirmation";
  s.stage = "awaiting_confirmation";
  ctx.effects.summary = summary;
  return {
    ok: true,
    ready: true,
    summary: {
      lines: summary.lines,
      subtotal: money(summary.subtotal),
      delivery_fee: money(summary.deliveryFee),
      total: money(summary.total),
      order_type: summary.orderType,
      address: summary.address,
      payment: summary.paymentMethod,
      name: summary.customerName,
    },
    show_buttons: ["confirm", "change", "cancel"],
    instruction: "The system sends this summary to the customer itself. Do not repeat or rewrite it.",
  };
}

export async function confirmOrderTool(ctx: BotContext): Promise<ToolResult> {
  const s = ctx.session;
  if (s.orderId) return { ok: true, order_number: null, already_placed: true };
  if (s.status !== "awaiting_confirmation" || !s.summaryHash) {
    return fail("NOT_AWAITING_CONFIRMATION", "Show the order summary first (show_order_summary) and wait for the customer to confirm it.");
  }
  if (!ctx.customer) return fail("NO_CUSTOMER", "Customer record is missing. Hand off to staff.");
  if (!ctx.branch.isOpenNow) return fail("BRANCH_CLOSED", "The restaurant just closed. Do not place the order.", { today_hours: ctx.branch.todayHours });

  // The customer agreed to exactly this: re-price now and compare.
  const problems = await repriceCart(ctx.store, s);
  const deliveryFee = deliveryTerms(s, ctx.branch).fee;
  if (problems.length || summaryHash(s, deliveryFee, ctx.customer.name ?? "") !== s.summaryHash) {
    invalidateSummary(s);
    return fail("CART_CHANGED", "The order changed since the summary (price, stock or details). Call show_order_summary again.");
  }

  // Decide BEFORE the order exists (placing it counts as one of their orders).
  const isNew = ctx.customer.totalOrders === 0;
  const total = cartSubtotal(s.cart) + deliveryFee;

  const result = await ctx.store.createOrder({
    session: s,
    customer: ctx.customer,
    deliveryFee,
    idempotencyKey: `bot-${s.id}-${s.summaryHash.slice(0, 16)}`,
    deliveryZoneId: s.deliveryZone?.zoneId ?? null,
  });
  if (!result.ok) {
    return fail(result.code, `${result.message} Apologise and hand off to staff.`);
  }

  const flags = [
    ...(isNew && s.paymentMethod === "cod" && total > ctx.restaurant.highValueCodThreshold ? ["New customer, high value — call to confirm."] : []),
    // Unlisted area delivered at the default fee (Phase 9).
    ...(s.orderType === "delivery" && s.deliveryZone?.flag ? [s.deliveryZone.flag] : []),
  ];
  if (!result.data.duplicate && flags.length) {
    await ctx.store.setRiskFlag(s.restaurantId, result.data.id, flags.join(" · "));
  }

  s.orderId = result.data.id;
  s.status = "completed";
  s.stage = "done";
  ctx.effects.order = { id: result.data.id, orderNumber: result.data.orderNumber };
  return { ok: true, order_number: result.data.orderNumber, instruction: "The system sends the confirmation message itself." };
}

export async function cancelSessionTool(ctx: BotContext): Promise<ToolResult> {
  const s = ctx.session;
  if (s.orderId) return fail("ALREADY_PLACED", "The order was already placed. To cancel it the customer must talk to staff: hand off.");
  s.cart = [];
  s.summaryHash = null;
  s.status = "abandoned";
  s.stage = "done";
  ctx.effects.cancelled = true;
  return { ok: true, instruction: "The system tells the customer the order is cancelled." };
}

export async function getRestaurantInfoTool(ctx: BotContext): Promise<ToolResult> {
  const b = ctx.branch;
  return {
    ok: true,
    name: ctx.restaurant.name,
    branch: b.name,
    open_now: b.isOpenNow,
    today_hours: b.todayHours,
    address: [b.address, b.area].filter(Boolean).join(", ") || null,
    phone: b.phone || ctx.restaurant.phone,
    week_hours: b.weekHours,
    delivery_fee: ctx.session.deliveryZone && ctx.session.deliveryZone.status !== "out_of_range" ? money(deliveryTerms({ ...ctx.session, orderType: "delivery" }, b).fee) : "depends on the area (ask for the address)",
    default_delivery_fee: money(b.deliveryFee),
    minimum_order_for_delivery: b.minimumOrder ? money(b.minimumOrder) : null,
    delivery_time: `about ${b.prepMinutes + b.deliveryMinutes} minutes`,
    pickup_ready_time: `about ${b.prepMinutes} minutes`,
    payment_methods: ctx.restaurant.paymentMethods.map((m) => (m === "cod" ? "cash on delivery" : "card on delivery")),
    dine_in_available: ctx.restaurant.dineInAvailable,
    has_location_pin: b.latitude != null && b.longitude != null,
  };
}

export async function checkOrderStatusTool(ctx: BotContext): Promise<ToolResult> {
  if (!ctx.customer) return { ok: true, orders: [] };
  const orders = await ctx.store.recentOrders(ctx.session.restaurantId, ctx.customer.id, 3);
  const tx = t(ctx.session.language);
  return {
    ok: true,
    orders: orders.map((o) => ({
      order_number: o.orderNumber,
      status: tx.status[o.status] ?? o.status,
      order_type: o.orderType,
      total: money(o.total),
      placed_at: o.createdAt,
    })),
    ...(orders.length ? {} : { message: "This customer has no orders with us yet." }),
  };
}

export async function handoffToStaffTool(ctx: BotContext, input: z.infer<typeof reasonSchema>): Promise<ToolResult> {
  ctx.session.status = "handed_off";
  ctx.session.handoffReason = input.reason;
  ctx.effects.handedOff = true;
  return { ok: true, instruction: "Tell the customer briefly (one line) that our staff will reply soon. Do not promise anything else." };
}

/** Called when the AI can't understand the customer. The 3rd time hands off. */
export async function markNotUnderstoodTool(ctx: BotContext): Promise<ToolResult> {
  ctx.session.failedAttempts += 1;
  if (ctx.session.failedAttempts >= BOT_LIMITS.maxFailedAttempts) {
    return handoffToStaffTool(ctx, { reason: `Bot could not understand the customer ${ctx.session.failedAttempts} times` });
  }
  return { ok: true, failed_attempts: ctx.session.failedAttempts, instruction: "Ask the customer to say it another way (one short question)." };
}
