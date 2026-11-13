import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

export type AuditAction =
  | "restaurant.updated"
  | "branch.created"
  | "branch.updated"
  | "staff.added"
  | "staff.role_changed"
  | "staff.branch_changed"
  | "staff.deactivated"
  | "staff.reactivated"
  | "menu_category.created"
  | "menu_category.updated"
  | "menu_category.archived"
  | "menu_item.created"
  | "menu_item.price_changed"
  | "menu_item.archived"
  | "modifier_group.archived"
  | "modifier_option.price_changed"
  | "customer.blocked"
  | "customer.unblocked"
  | "whatsapp.connected"
  | "whatsapp.disconnected"
  | "whatsapp.bot_resumed"
  | "bot.settings_changed"
  | "bot.budget_changed"
  | "bot.knowledge_changed"
  | "report.exported"
  | "data.exported"
  | "customer.deleted"
  | "support.viewed"
  | "subscription.changed"
  | "subscription.payment_recorded"
  | "restaurant.created_for_client"
  | "platform.settings_changed"
  | "plan.saved";
// Written inside the database: "restaurant.created", "menu_item.stock_changed",
// "menu.bulk_price_update", "order.cancelled", "order.edited",
// "order.blocked_customer_override" (written by the order engine).

/**
 * Append an entry to audit_logs as the signed-in user (RLS: members insert
 * their own entries; nobody can edit or delete them).
 * Never throws — a failed audit write is logged, not shown to the user.
 */
export async function writeAuditLog(
  supabase: SupabaseClient<Database>,
  entry: {
    restaurantId: string;
    userId: string;
    action: AuditAction;
    entityType: string;
    entityId: string;
    oldData?: Json;
    newData?: Json;
  },
) {
  const { error } = await supabase.from("audit_logs").insert({
    restaurant_id: entry.restaurantId,
    user_id: entry.userId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    old_data: entry.oldData ?? null,
    new_data: entry.newData ?? null,
  });
  if (error) console.error("[audit] failed to write", entry.action, error.message);
}

/** Keep only fields that changed, as { field: value } pairs. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const oldData: Record<string, unknown> = {};
  const newData: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (after[key] !== undefined && after[key] !== before[key]) {
      oldData[key as string] = before[key] ?? null;
      newData[key as string] = after[key] ?? null;
    }
  }
  return { oldData: oldData as Json, newData: newData as Json, changed: Object.keys(newData).length > 0 };
}
