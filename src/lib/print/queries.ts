import "server-only";
import type { CurrentContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import type { BillData, KotData, PaperWidth, ReceiptItem } from "./types";

/**
 * Receipt data. Runs as the signed-in user (RLS).
 * - KOT reads the kitchen-safe view (no phone/address/money), so kitchen
 *   users can print it.
 * - Bill reads the orders table (front of house only).
 */

export async function getPrintSettings(restaurantId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("restaurants")
    .select("receipt_paper_width, bill_header, bill_footer")
    .eq("id", restaurantId)
    .single();
  return {
    width: (data?.receipt_paper_width ?? "80mm") as PaperWidth,
    header: data?.bill_header ?? null,
    footer: data?.bill_footer ?? null,
  };
}

type ItemRow = {
  quantity: number;
  item_name: string;
  size_name: string | null;
  removals: string[];
  notes: string | null;
  unit_price: number;
  line_total: number;
  modifiers: { option_name: string }[];
};

function toItems(rows: ItemRow[], withPrices: boolean): ReceiptItem[] {
  return rows.map((i) => ({
    quantity: i.quantity,
    name: i.item_name,
    size: i.size_name,
    extras: i.modifiers.map((m) => m.option_name),
    removals: i.removals,
    notes: i.notes,
    ...(withPrices ? { unitPrice: i.unit_price, lineTotal: i.line_total } : {}),
  }));
}

export async function getKotData(ctx: CurrentContext, orderId: string): Promise<KotData | null> {
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("kitchen_orders")
    .select("id, branch_id, order_number, order_type, table_number, notes, created_at")
    .eq("id", orderId)
    .eq("restaurant_id", ctx.restaurant.id)
    .maybeSingle();
  if (!order) return null;
  const [{ data: items }, { data: branch }] = await Promise.all([
    supabase
      .from("order_items")
      .select("quantity, item_name, size_name, removals, notes, unit_price, line_total, created_at, modifiers:order_item_modifiers(option_name)")
      .eq("order_id", orderId)
      .eq("is_cancelled", false)
      .order("created_at"),
    supabase.from("branches").select("name").eq("id", order.branch_id!).maybeSingle(),
  ]);
  return {
    orderNumber: order.order_number!,
    orderType: order.order_type!,
    tableNumber: order.table_number,
    branchName: branch?.name ?? "",
    createdAt: order.created_at!,
    timezone: ctx.restaurant.timezone || DEFAULT_TIMEZONE,
    notes: order.notes,
    // Never pass prices to the kitchen slip.
    items: toItems((items ?? []) as ItemRow[], false),
  };
}

export async function getBillData(ctx: CurrentContext, orderId: string): Promise<BillData | null> {
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select(
      "order_number, order_type, table_number, created_at, customer_name, customer_phone, address_text, area, landmark, subtotal, delivery_fee, discount, total, payment_method, payment_status, notes, branch:branches(name, address, phone), items:order_items(quantity, item_name, size_name, removals, notes, unit_price, line_total, is_cancelled, created_at, modifiers:order_item_modifiers(option_name))",
    )
    .eq("id", orderId)
    .eq("restaurant_id", ctx.restaurant.id)
    .maybeSingle();
  if (!order) return null;
  const settings = await getPrintSettings(ctx.restaurant.id);
  const items = [...order.items].filter((i) => !i.is_cancelled).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const delivery = order.order_type === "delivery";
  return {
    restaurantName: ctx.restaurant.name,
    branchName: order.branch?.name ?? "",
    address: order.branch?.address ?? null,
    phone: order.branch?.phone ?? ctx.restaurant.phone ?? null,
    header: settings.header,
    footer: settings.footer,
    orderNumber: order.order_number,
    orderType: order.order_type,
    tableNumber: order.table_number,
    createdAt: order.created_at,
    timezone: ctx.restaurant.timezone || DEFAULT_TIMEZONE,
    customerName: order.customer_name,
    customerPhone: delivery ? order.customer_phone : null,
    deliveryAddress: delivery
      ? [order.address_text, order.area, order.landmark && `Near ${order.landmark}`].filter(Boolean).join(", ")
      : null,
    items: toItems(items as ItemRow[], true),
    subtotal: order.subtotal,
    deliveryFee: order.delivery_fee,
    discount: order.discount,
    total: order.total,
    paymentMethod: order.payment_method,
    paid: order.payment_status === "paid",
    notes: order.notes,
  };
}
