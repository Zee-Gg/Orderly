import { z } from "zod";
import { paisaSchema } from "@/lib/validation/menu";
import { ORDER_SOURCES, ORDER_STATUSES, ORDER_TYPES, PAYMENT_METHODS } from "./constants";

/** One cart line as the cashier (or the bot) chose it. No prices: the engine prices it. */
export const cartLineSchema = z.object({
  itemId: z.uuid(),
  variantId: z.uuid().nullable().optional(),
  optionIds: z.array(z.uuid()).max(50).default([]),
  removals: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  quantity: z.number().int().min(1, "At least 1").max(99, "Up to 99"),
  notes: z.string().trim().max(300, "Note is too long").optional().default(""),
});
export type CartLineInput = z.input<typeof cartLineSchema>;

const addressSchema = z.object({
  addressText: z.string().trim().max(500, "Address is too long").default(""),
  area: z.string().trim().max(80).optional().default(""),
  landmark: z.string().trim().max(200).optional().default(""),
  label: z.string().trim().max(40).optional().default(""),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  /** Save to the customer's address book. */
  save: z.boolean().default(true),
});

const orderFields = {
  orderType: z.enum(ORDER_TYPES as [string, ...string[]]).pipe(z.custom<(typeof ORDER_TYPES)[number]>()),
  paymentMethod: z.enum(PAYMENT_METHODS as [string, ...string[]]).pipe(z.custom<(typeof PAYMENT_METHODS)[number]>()),
  address: addressSchema.optional(),
  tableNumber: z.string().trim().max(20, "Table number is too long").optional().default(""),
  notes: z.string().trim().max(1000, "Note is too long").optional().default(""),
  deliveryFee: paisaSchema.default(0),
  discount: paisaSchema.default(0),
  lines: z.array(cartLineSchema).min(1, "Add at least one item").max(50, "Up to 50 lines per order"),
};

function refineOrder(
  v: { orderType: string; address?: { addressText: string }; deliveryFee: number },
  ctx: z.RefinementCtx,
) {
  if (v.orderType === "delivery" && !v.address?.addressText) {
    ctx.addIssue({ code: "custom", path: ["address", "addressText"], message: "Delivery orders need an address" });
  }
  if (v.orderType !== "delivery" && v.deliveryFee > 0) {
    ctx.addIssue({ code: "custom", path: ["deliveryFee"], message: "Only delivery orders have a delivery fee" });
  }
}

export const createOrderSchema = z
  .object({
    branchId: z.uuid("Choose a branch"),
    /** Generated once per order screen; retries/double taps reuse it. */
    idempotencyKey: z.string().min(8).max(100),
    source: z.enum(ORDER_SOURCES as [string, ...string[]]).pipe(z.custom<(typeof ORDER_SOURCES)[number]>()),
    customer: z
      .object({
        phone: z.string().trim().max(30).optional().default(""),
        name: z.string().trim().max(120, "Name is too long").optional().default(""),
      })
      .default({ phone: "", name: "" }),
    /** Set only when staff place an order for a blocked customer on purpose. */
    overrideBlockReason: z.string().trim().max(200).optional().default(""),
    ...orderFields,
  })
  .superRefine((v, ctx) => {
    refineOrder(v, ctx);
    if ((v.orderType === "delivery" || v.source === "phone" || v.source === "whatsapp") && !v.customer.phone) {
      ctx.addIssue({ code: "custom", path: ["customer", "phone"], message: "Enter the customer's phone number" });
    }
  });
export type CreateOrderInput = z.input<typeof createOrderSchema>;

export const editOrderSchema = z
  .object({
    orderId: z.uuid(),
    expectedVersion: z.number().int().min(1),
    ...orderFields,
  })
  .superRefine(refineOrder);
export type EditOrderInput = z.input<typeof editOrderSchema>;

export const transitionSchema = z.object({
  orderId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  path: z
    .array(z.enum(ORDER_STATUSES as [string, ...string[]]).pipe(z.custom<(typeof ORDER_STATUSES)[number]>()))
    .min(1)
    .max(3),
  reason: z.string().trim().max(60).optional().default(""),
  note: z.string().trim().max(300, "Note is too long").optional().default(""),
});
export type TransitionInput = z.input<typeof transitionSchema>;

export const holdSchema = z.object({
  orderId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  hold: z.boolean(),
  reason: z.string().trim().max(300).optional().default(""),
});
export type HoldInput = z.input<typeof holdSchema>;

export const paymentSchema = z.object({
  orderId: z.uuid(),
  method: z.enum(PAYMENT_METHODS as [string, ...string[]]).pipe(z.custom<(typeof PAYMENT_METHODS)[number]>()),
  reference: z.string().trim().max(100, "Reference is too long").optional().default(""),
});
export type PaymentInput = z.input<typeof paymentSchema>;
