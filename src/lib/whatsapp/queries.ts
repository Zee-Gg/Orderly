import "server-only";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, MEDIA_URL_TTL_SECONDS } from "./config";
import { STATUS_MESSAGE_KEYS } from "./order-messages";

/** Inbox reads, as the signed-in user (RLS: front of house of this restaurant). */
export type InboxConversation = {
  id: string;
  waId: string;
  name: string | null;
  phone: string | null;
  lastMessageAt: string | null;
  preview: string | null;
  status: "open" | "resolved";
  /** false = the bot handed this chat to staff ("Needs staff"). */
  botEnabled: boolean;
  handoffReason: string | null;
  handedOffAt: string | null;
};

export type InboxMessage = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  status: string;
  error: string | null;
  createdAt: string;
  /** Signed URL (1 hour) for files we stored, or the https link we sent. */
  mediaUrl: string | null;
  mediaMimeType: string | null;
  orderId: string | null;
};

export async function listConversations(restaurantId: string): Promise<InboxConversation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .select("id, wa_id, last_message_at, last_message_preview, status, bot_enabled, handoff_reason, handed_off_at, customer:customers(name, phone)")
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
    botEnabled: c.bot_enabled,
    handoffReason: c.handoff_reason,
    handedOffAt: c.handed_off_at,
  }));
}

/** Latest 200 messages of one conversation, oldest first. */
export async function listMessages(restaurantId: string, conversationId: string): Promise<InboxMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id, direction, type, body, status, error, created_at, media_url, media_mime_type, order_id")
    .eq("restaurant_id", restaurantId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);

  // Customer files live in a private bucket: sign them as this user (Storage RLS
  // only allows this restaurant's folder). Links we sent ourselves are already public.
  const paths = [...new Set((data ?? []).map((m) => m.media_url).filter((u): u is string => !!u && !u.startsWith("https://")))];
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(paths, MEDIA_URL_TTL_SECONDS);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }

  return (data ?? []).reverse().map((m) => ({
    id: m.id,
    direction: m.direction,
    type: m.type,
    body: m.body,
    status: m.status,
    error: m.error,
    createdAt: m.created_at,
    mediaUrl: m.media_url ? (m.media_url.startsWith("https://") ? m.media_url : (signed.get(m.media_url) ?? null)) : null,
    mediaMimeType: m.media_mime_type,
    orderId: m.order_id,
  }));
}

/** The restaurant's connected WhatsApp number (no token: column grants), or null. */
export async function getWhatsAppNumber(restaurantId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_accounts")
    .select("display_phone_number, is_active, connected_at, branch_id")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  return data;
}

/** Which order status messages are on (missing keys = on). */
export async function getStatusMessageSettings(restaurantId: string): Promise<Record<string, boolean>> {
  const supabase = await createClient();
  const { data } = await supabase.from("restaurants").select("whatsapp_status_messages").eq("id", restaurantId).maybeSingle();
  const raw = data?.whatsapp_status_messages;
  const saved = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(STATUS_MESSAGE_KEYS.map((k) => [k, saved[k] !== false]));
}
