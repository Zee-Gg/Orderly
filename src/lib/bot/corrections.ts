import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

/**
 * When staff fix a bot order BEFORE accepting it, the before/after is a free
 * lesson for the bot: saved in ai_corrections and exported as eval cases
 * (scripts/export-ai-corrections.ts). Admin client, scoped by restaurant.
 * No Next.js imports.
 */
type Db = SupabaseClient<Database>;

export type OrderSnapshot = {
  orderType: string;
  paymentMethod: string;
  lines: { item: string; size: string | null; quantity: number; extras: string[]; removals: string[]; notes: string }[];
};

export async function snapshotOrder(db: Db, restaurantId: string, orderId: string): Promise<OrderSnapshot | null> {
  const { data } = await db
    .from("orders")
    .select("order_type, payment_method, items:order_items(item_name, size_name, quantity, removals, notes, is_cancelled, created_at, modifiers:order_item_modifiers(option_name))")
    .eq("id", orderId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (!data) return null;
  return {
    orderType: data.order_type,
    paymentMethod: data.payment_method,
    lines: data.items
      .filter((i) => !i.is_cancelled)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((i) => ({
        item: i.item_name,
        size: i.size_name,
        quantity: i.quantity,
        extras: i.modifiers.map((m) => m.option_name),
        removals: i.removals ?? [],
        notes: i.notes ?? "",
      })),
  };
}

/** A bot order still waiting for acceptance → what it looks like now (else null). */
export async function correctionCandidate(db: Db, restaurantId: string, orderId: string) {
  const [{ data: order }, { data: session }] = await Promise.all([
    db.from("orders").select("status").eq("id", orderId).eq("restaurant_id", restaurantId).maybeSingle(),
    db.from("bot_sessions").select("id").eq("order_id", orderId).eq("restaurant_id", restaurantId).limit(1).maybeSingle(),
  ]);
  if (!order || !session || order.status !== "awaiting_acceptance") return null;
  const before = await snapshotOrder(db, restaurantId, orderId);
  return before ? { sessionId: session.id, before } : null;
}

export async function recordCorrection(
  db: Db,
  input: { restaurantId: string; orderId: string; sessionId: string; before: OrderSnapshot; editedBy: string },
): Promise<boolean> {
  const after = await snapshotOrder(db, input.restaurantId, input.orderId);
  if (!after || JSON.stringify(after) === JSON.stringify(input.before)) return false;
  const { error } = await db.from("ai_corrections").insert({
    restaurant_id: input.restaurantId,
    order_id: input.orderId,
    session_id: input.sessionId,
    before: input.before as unknown as Json,
    after: after as unknown as Json,
    edited_by: input.editedBy,
  });
  if (error) throw new Error(`ai correction: ${error.message}`);
  return true;
}
