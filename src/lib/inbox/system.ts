import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Small grey lines in the inbox chat ("Order #1045 created", "Handed to
 * staff: …", "Bot turned back on by Ali"). Stored as whatsapp_messages with
 * sender_type = system; NEVER sent to WhatsApp. No Next.js imports.
 */
export async function addSystemLine(db: SupabaseClient<Database>, restaurantId: string, conversationId: string, text: string, orderId?: string | null) {
  const { error } = await db.from("whatsapp_messages").insert({
    restaurant_id: restaurantId,
    conversation_id: conversationId,
    direction: "outbound",
    type: "text",
    body: text.slice(0, 500),
    status: "sent",
    sender_type: "system",
    order_id: orderId ?? null,
  });
  if (error) console.error("[inbox] system line not saved", error.message);
}
