import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Inbox reads, as the signed-in user (RLS: front of house of this restaurant). */
export type InboxConversation = {
  id: string;
  waId: string;
  name: string | null;
  phone: string | null;
  lastMessageAt: string | null;
  preview: string | null;
  status: "open" | "resolved";
};

export type InboxMessage = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  status: string;
  error: string | null;
  createdAt: string;
};

export async function listConversations(restaurantId: string): Promise<InboxConversation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .select("id, wa_id, last_message_at, last_message_preview, status, customer:customers(name, phone)")
    .eq("restaurant_id", restaurantId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id,
    waId: c.wa_id,
    name: c.customer?.name ?? null,
    phone: c.customer?.phone ?? null,
    lastMessageAt: c.last_message_at,
    preview: c.last_message_preview,
    status: c.status,
  }));
}

/** Latest 200 messages of one conversation, oldest first. */
export async function listMessages(restaurantId: string, conversationId: string): Promise<InboxMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id, direction, type, body, status, error, created_at")
    .eq("restaurant_id", restaurantId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).reverse().map((m) => ({
    id: m.id,
    direction: m.direction,
    type: m.type,
    body: m.body,
    status: m.status,
    error: m.error,
    createdAt: m.created_at,
  }));
}
