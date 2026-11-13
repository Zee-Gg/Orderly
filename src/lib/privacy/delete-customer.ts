import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_BUCKET } from "@/lib/whatsapp/config";
import type { Database } from "@/types/database";

/**
 * Delete one customer's personal data (privacy request, Phase 12).
 * ADMIN client only, after the caller checked permission. The database
 * function anonymizes orders ("Deleted customer"), deletes chats/messages/
 * transcripts/addresses and the customer row; here we also remove their
 * WhatsApp media files from Storage. The caller writes audit_logs.
 */
export async function deleteCustomerData(admin: SupabaseClient<Database>, restaurantId: string, customerId: string) {
  const { data, error } = await admin.rpc("delete_customer_data", { p_restaurant_id: restaurantId, p_customer_id: customerId });
  if (error) throw error;
  const result = (data ?? {}) as { orders_anonymized?: number; conversations_deleted?: number; media_paths?: string[] };
  // Only files inside this restaurant's folder.
  const paths = (result.media_paths ?? []).filter((p) => typeof p === "string" && p.startsWith(`${restaurantId}/`));
  let mediaDeleted = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const { data: removed, error: rmError } = await admin.storage.from(MEDIA_BUCKET).remove(paths.slice(i, i + 100));
    if (rmError) console.error("[privacy] media delete failed", rmError.message);
    mediaDeleted += removed?.length ?? 0;
  }
  return {
    ordersAnonymized: result.orders_anonymized ?? 0,
    conversationsDeleted: result.conversations_deleted ?? 0,
    mediaDeleted,
  };
}
