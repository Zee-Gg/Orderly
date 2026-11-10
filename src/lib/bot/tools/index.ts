import { tool, type ToolSet } from "ai";
import type { z } from "zod";
import {
  addToCartSchema,
  addToCartTool,
  emptySchema,
  lineIdSchema,
  removeCartLineTool,
  searchMenuSchema,
  searchMenuTool,
  updateCartLineTool,
  updateLineSchema,
  viewCartTool,
} from "./cart-tools";
import { fail, type BotContext, type ToolResult } from "./context";
import {
  addressSchema,
  cancelSessionTool,
  checkOrderStatusTool,
  confirmOrderTool,
  getRestaurantInfoTool,
  handoffToStaffTool,
  markNotUnderstoodTool,
  nameSchema,
  orderTypeSchema,
  paymentSchema,
  reasonSchema,
  setCustomerNameTool,
  setDeliveryAddressTool,
  setOrderTypeTool,
  setPaymentMethodTool,
  showOrderSummaryTool,
} from "./order-tools";

export type { BotContext, ToolResult } from "./context";

/* eslint-disable @typescript-eslint/no-explicit-any -- one registry for tools with different input types */
type Def = { description: string; schema: z.ZodType<any>; run: (ctx: BotContext, input: any) => Promise<ToolResult> };

/** Every bot tool: what the AI sees (description + schema) and what runs (our code). */
export const BOT_TOOLS: Record<string, Def> = {
  search_menu: {
    description: "Find menu items by name, Urdu name, other names or category (handles misspellings and Roman Urdu). Use for anything not clearly in the menu list, and to check availability.",
    schema: searchMenuSchema,
    run: searchMenuTool,
  },
  add_to_cart: {
    description: "Add an item to the cart. The pricing engine validates it. On SIZE_REQUIRED / REQUIRED_GROUP_MISSING the result lists the valid choices: ask the customer. Same item + same choices merges into one line.",
    schema: addToCartSchema,
    run: addToCartTool,
  },
  update_cart_line: {
    description: "Change a cart line: quantity (0 removes), size, extras/choices (replaces all), removals (replaces all), notes.",
    schema: updateLineSchema,
    run: updateCartLineTool,
  },
  remove_cart_line: { description: "Remove one cart line by line_id.", schema: lineIdSchema, run: removeCartLineTool },
  view_cart: { description: "Current cart lines (with line ids) and subtotal from the pricing engine.", schema: emptySchema, run: viewCartTool },
  set_order_type: { description: "Delivery or pickup.", schema: orderTypeSchema, run: setOrderTypeTool },
  set_delivery_address: {
    description: "Save the delivery address. Riders need a landmark or a location pin; without one the result is LANDMARK_REQUIRED.",
    schema: addressSchema,
    run: setDeliveryAddressTool,
  },
  set_payment_method: { description: "cod = cash on delivery, card_on_delivery = card machine at the door/counter.", schema: paymentSchema, run: setPaymentMethodTool },
  set_customer_name: { description: "Save the customer's name (only ask if we don't have it).", schema: nameSchema, run: setCustomerNameTool },
  show_order_summary: {
    description: "When items, order type, address (delivery), payment and name are all set: checks everything and sends the customer the final summary with Confirm/Change/Cancel buttons. If something is missing it returns what to ask.",
    schema: emptySchema,
    run: showOrderSummaryTool,
  },
  confirm_order: {
    description: "Place the order. ONLY after the customer clearly confirms the summary they were shown (e.g. 'confirm', 'haan theek hai', 'yes').",
    schema: emptySchema,
    run: confirmOrderTool,
  },
  cancel_session: { description: "The customer wants to cancel this order before it is placed: clears the cart.", schema: emptySchema, run: cancelSessionTool },
  get_restaurant_info: {
    description: "Restaurant name, open now or not, today's hours, address, phone, delivery fee, minimum order, payment methods.",
    schema: emptySchema,
    run: getRestaurantInfoTool,
  },
  check_order_status: { description: "This customer's recent orders and their status.", schema: emptySchema, run: checkOrderStatusTool },
  handoff_to_staff: {
    description: "Pass the chat to a human: customer asks for a person, complains, is angry, wants a refund, or asks something the tools can't answer.",
    schema: reasonSchema,
    run: handoffToStaffTool,
  },
  mark_not_understood: {
    description: "Call when you can't understand what the customer wants. After 3 times the chat is handed to staff automatically.",
    schema: emptySchema,
    run: markNotUnderstoodTool,
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export type ToolCallLog = { tool: string; input: unknown; output: ToolResult; ms: number };

/** Run one tool by name: validates input (Zod), never throws. */
export async function runTool(ctx: BotContext, name: string, rawInput: unknown): Promise<ToolResult> {
  const def = BOT_TOOLS[name];
  if (!def) return fail("UNKNOWN_TOOL", `There is no tool "${name}".`);
  const parsed = def.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return fail("INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  }
  try {
    return await def.run(ctx, parsed.data);
  } catch (err) {
    console.error(`[bot] tool ${name} failed`, err instanceof Error ? err.message : err);
    return fail("INTERNAL_ERROR", "Something went wrong on our side. Apologise and hand off to staff.");
  }
}

/** AI SDK tools bound to this turn's context; every call is recorded in `log`. */
export function createAiTools(ctx: BotContext, log: ToolCallLog[]): ToolSet {
  return Object.fromEntries(
    Object.entries(BOT_TOOLS).map(([name, def]) => [
      name,
      tool({
        description: def.description,
        inputSchema: def.schema,
        execute: async (input: unknown) => {
          const started = Date.now();
          const output = await runTool(ctx, name, input);
          log.push({ tool: name, input, output, ms: Date.now() - started });
          return output;
        },
      }),
    ]),
  );
}
