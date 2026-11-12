import "server-only";
import type { CurrentContext } from "@/lib/auth/session";
import type { CartLine } from "@/lib/bot/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, MEDIA_URL_TTL_SECONDS } from "@/lib/whatsapp/config";

/**
 * Inbox read models (Phase 10). Run as the signed-in member (RLS: owner,
 * manager, staff of this restaurant only — kitchen and riders get nothing).
 */

export type InboxConversation = {
  id: string;
  waId: string;
  customerId: string | null;
  name: string | null;
  phone: string | null;
  lastMessageAt: string | null;
  lastCustomerMessageAt: string | null;
  preview: string | null;
  status: "open" | "resolved";
  botEnabled: boolean;
  needsStaff: boolean;
  needsStaffSince: string | null;
  handoffReason: string | null;
  unreadCount: number;
  assignedTo: string | null;
  tags: string[];
};

export type StaffMember = { id: string; name: string };

export type InboxMessage = {
  id: string;
  direction: "inbound" | "outbound";
  senderType: "customer" | "bot" | "staff" | "system";
  senderName: string | null;
  type: string;
  body: string | null;
  status: string;
  error: string | null;
  createdAt: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  orderId: string | null;
  transcript: string | null;
  /** Buttons the bot sent ([Confirm] [Change]) or the button the customer tapped. */
  buttons: string[];
  /** A location the customer shared. */
  location: { latitude: number; longitude: number; name: string | null; address: string | null } | null;
  /** Failed text/image/document/location we can send again. */
  retryable: boolean;
  /** A grey line in the chat that was never sent to WhatsApp. */
  systemLine: boolean;
};

export type ConversationNote = { id: string; body: string; userName: string | null; createdAt: string };

export type CustomerPanel = {
  id: string;
  name: string | null;
  phone: string;
  notes: string | null;
  tags: string[];
  isBlocked: boolean;
  blockedReason: string | null;
  totalOrders: number;
  totalSpent: number;
  riskCount: number;
  addresses: { id: string; label: string | null; addressText: string; area: string | null; landmark: string | null }[];
  orders: { id: string; orderNumber: number; status: string; total: number; createdAt: string; itemCount: number; cancelReason: string | null }[];
};

export type BotCart = {
  sessionId: string;
  stage: string;
  status: string;
  orderType: string | null;
  lines: { name: string; quantity: number; sizeName: string | null; lineTotal: number }[];
  subtotal: number;
};

export type ConversationDetail = {
  conversation: InboxConversation;
  messages: InboxMessage[];
  notes: ConversationNote[];
  customer: CustomerPanel | null;
  botCart: BotCart | null;
};

export type InboxSettings = { autoResolveHours: number; needsStaffAlertMinutes: number };

const CONV_SELECT =
  "id, wa_id, customer_id, last_message_at, last_customer_message_at, last_message_preview, status, bot_enabled, needs_staff, needs_staff_since, handoff_reason, unread_count, assigned_to, tags, customer:customers(name, phone)";

type ConvRow = {
  id: string;
  wa_id: string;
  customer_id: string | null;
  last_message_at: string | null;
  last_customer_message_at: string | null;
  last_message_preview: string | null;
  status: "open" | "resolved";
  bot_enabled: boolean;
  needs_staff: boolean;
  needs_staff_since: string | null;
  handoff_reason: string | null;
  unread_count: number;
  assigned_to: string | null;
  tags: string[];
  customer: { name: string | null; phone: string } | null;
};

function toConversation(c: ConvRow): InboxConversation {
  return {
    id: c.id,
    waId: c.wa_id,
    customerId: c.customer_id,
    name: c.customer?.name ?? null,
    phone: c.customer?.phone ?? `+${c.wa_id}`,
    lastMessageAt: c.last_message_at,
    lastCustomerMessageAt: c.last_customer_message_at,
    preview: c.last_message_preview,
    status: c.status,
    botEnabled: c.bot_enabled,
    needsStaff: c.needs_staff,
    needsStaffSince: c.needs_staff_since,
    handoffReason: c.handoff_reason,
    unreadCount: c.unread_count,
    assignedTo: c.assigned_to,
    tags: c.tags ?? [],
  };
}

export async function listConversations(ctx: CurrentContext, search = ""): Promise<InboxConversation[]> {
  const db = await createClient();
  let q = db.from("whatsapp_conversations").select(CONV_SELECT).eq("restaurant_id", ctx.restaurant.id);
  const term = search.trim().replace(/[%,()]/g, "");
  if (term) {
    const digits = term.replace(/\D/g, "");
    const { data: matches } = await db
      .from("customers")
      .select("id")
      .eq("restaurant_id", ctx.restaurant.id)
      .or(`name.ilike.%${term}%${digits.length >= 3 ? `,phone.ilike.%${digits}%` : ""}`)
      .limit(100);
    const ids = (matches ?? []).map((m) => m.id);
    q = digits.length >= 3 ? q.or(`wa_id.ilike.%${digits}%${ids.length ? `,customer_id.in.(${ids.join(",")})` : ""}`) : q.in("customer_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  const { data, error } = await q.order("last_message_at", { ascending: false, nullsFirst: false }).limit(200);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ConvRow[]).map(toConversation);
}

/** Owner/manager/staff of this restaurant (assign dropdown, staff names on messages). */
export async function listStaff(ctx: CurrentContext): Promise<StaffMember[]> {
  const db = await createClient();
  const { data } = await db
    .from("memberships")
    .select("user_id, role, profile:profiles(full_name)")
    .eq("restaurant_id", ctx.restaurant.id)
    .eq("is_active", true)
    .in("role", ["owner", "manager", "staff"]);
  return (data ?? []).map((m) => ({ id: m.user_id, name: (m.profile as { full_name: string | null } | null)?.full_name || "Staff" }));
}

export async function getInboxSettings(ctx: CurrentContext): Promise<InboxSettings> {
  const db = await createClient();
  const { data } = await db.from("restaurants").select("auto_resolve_hours, needs_staff_alert_minutes").eq("id", ctx.restaurant.id).single();
  return { autoResolveHours: data?.auto_resolve_hours ?? 6, needsStaffAlertMinutes: data?.needs_staff_alert_minutes ?? 3 };
}

/** "Text\n[Confirm] [Change]" (what we save for interactive messages) → buttons. */
function splitButtons(body: string | null): { text: string | null; buttons: string[] } {
  if (!body) return { text: body, buttons: [] };
  const lines = body.split("\n");
  const last = lines.at(-1) ?? "";
  const buttons = [...last.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  if (buttons.length && last.replace(/\[[^\]]+\]/g, "").trim() === "") return { text: lines.slice(0, -1).join("\n"), buttons };
  return { text: body, buttons: [] };
}

export async function getConversationDetail(ctx: CurrentContext, conversationId: string, staff: StaffMember[]): Promise<ConversationDetail | null> {
  const db = await createClient();
  const { data: conv } = await db.from("whatsapp_conversations").select(CONV_SELECT).eq("id", conversationId).eq("restaurant_id", ctx.restaurant.id).maybeSingle();
  if (!conv) return null;
  const conversation = toConversation(conv as unknown as ConvRow);
  const names = new Map(staff.map((s) => [s.id, s.name]));

  const [msgs, notes, customer, addresses, orders, session] = await Promise.all([
    db
      .from("whatsapp_messages")
      .select("id, direction, sender_type, sent_by_user_id, type, body, status, error, created_at, media_url, media_mime_type, order_id, transcript, raw, wa_message_id")
      .eq("restaurant_id", ctx.restaurant.id)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(200),
    db.from("conversation_notes").select("id, body, user_id, created_at").eq("conversation_id", conversationId).eq("restaurant_id", ctx.restaurant.id).order("created_at"),
    conversation.customerId
      ? db
          .from("customers")
          .select("id, name, phone, notes, tags, is_blocked, blocked_reason, total_orders, total_spent, cancelled_count, refused_count")
          .eq("id", conversation.customerId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    conversation.customerId
      ? db.from("customer_addresses").select("id, label, address_text, area, landmark").eq("customer_id", conversation.customerId).order("created_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [] }),
    conversation.customerId
      ? db
          .from("orders")
          .select("id, order_number, status, total, created_at, cancel_reason, items:order_items(quantity, is_cancelled)")
          .eq("customer_id", conversation.customerId)
          .eq("restaurant_id", ctx.restaurant.id)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
    db
      .from("bot_sessions")
      .select("id, stage, status, order_type, cart")
      .eq("restaurant_id", ctx.restaurant.id)
      .eq("conversation_id", conversationId)
      .in("status", ["active", "awaiting_confirmation", "handed_off"])
      .order("last_activity_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Customer files are in a private bucket: sign as this user (Storage RLS: own restaurant only).
  const rows = (msgs.data ?? []).reverse();
  const paths = [...new Set(rows.map((m) => m.media_url).filter((u): u is string => !!u && !u.startsWith("https://")))];
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await db.storage.from(MEDIA_BUCKET).createSignedUrls(paths, MEDIA_URL_TTL_SECONDS);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }

  const messages: InboxMessage[] = rows.map((m) => {
    const raw = (m.raw ?? null) as Record<string, unknown> | null;
    const parts = m.type === "interactive" && m.direction === "outbound" ? splitButtons(m.body) : { text: m.body, buttons: [] as string[] };
    const loc = m.type === "location" && m.direction === "inbound" ? ((raw?.location ?? null) as { latitude?: number; longitude?: number; name?: string; address?: string } | null) : null;
    const tapped =
      m.direction === "inbound" && (m.type === "interactive" || m.type === "button")
        ? [String((raw?.interactive as { button_reply?: { title?: string } } | undefined)?.button_reply?.title ?? (raw?.button as { text?: string } | undefined)?.text ?? m.body ?? "")].filter(Boolean)
        : [];
    return {
      id: m.id,
      direction: m.direction,
      senderType: (m.sender_type as InboxMessage["senderType"]) ?? (m.direction === "inbound" ? "customer" : "bot"),
      senderName: m.sent_by_user_id ? (names.get(m.sent_by_user_id) ?? "Staff") : null,
      type: m.type,
      body: parts.text,
      status: m.status,
      error: m.error,
      createdAt: m.created_at,
      mediaUrl: m.media_url ? (m.media_url.startsWith("https://") ? m.media_url : (signed.get(m.media_url) ?? null)) : null,
      mediaMimeType: m.media_mime_type,
      orderId: m.order_id,
      transcript: m.transcript,
      buttons: parts.buttons.length ? parts.buttons : tapped,
      location:
        loc && typeof loc.latitude === "number" && typeof loc.longitude === "number"
          ? { latitude: loc.latitude, longitude: loc.longitude, name: loc.name ?? null, address: loc.address ?? null }
          : null,
      systemLine: m.sender_type === "system" && m.direction === "outbound" && !m.wa_message_id && !raw && m.status === "sent",
      retryable: m.direction === "outbound" && m.status === "failed" && m.sender_type !== "system" && !!raw && ["text", "image", "document", "location"].includes(String(raw.kind)),
    };
  });

  const c = customer.data;
  const cart = session.data ? ((Array.isArray(session.data.cart) ? session.data.cart : []) as unknown as CartLine[]) : [];
  return {
    conversation,
    messages,
    notes: (notes.data ?? []).map((n) => ({ id: n.id, body: n.body, userName: n.user_id ? (names.get(n.user_id) ?? "Staff") : null, createdAt: n.created_at })),
    customer: c
      ? {
          id: c.id,
          name: c.name,
          phone: c.phone,
          notes: c.notes,
          tags: c.tags,
          isBlocked: c.is_blocked,
          blockedReason: c.blocked_reason,
          totalOrders: c.total_orders,
          totalSpent: c.total_spent,
          riskCount: c.cancelled_count + c.refused_count,
          addresses: (addresses.data ?? []).map((a) => ({ id: a.id, label: a.label, addressText: a.address_text, area: a.area, landmark: a.landmark })),
          orders: (orders.data ?? []).map((o) => ({
            id: o.id,
            orderNumber: o.order_number,
            status: o.status,
            total: o.total,
            createdAt: o.created_at,
            cancelReason: o.cancel_reason,
            itemCount: (o.items as { quantity: number; is_cancelled: boolean }[]).filter((i) => !i.is_cancelled).reduce((n, i) => n + i.quantity, 0),
          })),
        }
      : null,
    botCart:
      session.data && cart.length
        ? {
            sessionId: session.data.id,
            stage: session.data.stage,
            status: session.data.status,
            orderType: session.data.order_type,
            lines: cart.map((l) => ({ name: l.name, quantity: l.quantity, sizeName: l.sizeName, lineTotal: l.lineTotal })),
            subtotal: cart.reduce((n, l) => n + l.lineTotal, 0),
          }
        : null,
  };
}

export async function listQuickReplies(ctx: CurrentContext) {
  const db = await createClient();
  const { data } = await db.from("quick_replies").select("id, shortcut, text, sort_order").eq("restaurant_id", ctx.restaurant.id).order("sort_order").order("shortcut");
  return (data ?? []).map((r) => ({ id: r.id, shortcut: r.shortcut, text: r.text }));
}

/** Staff-handled chats quiet for auto_resolve_hours → resolved, bot back on (server sweep). */
export async function sweepAutoResolve(restaurantId: string) {
  const { error } = await createAdminClient().rpc("inbox_auto_resolve", { p_restaurant_id: restaurantId });
  if (error) console.error("[inbox] auto-resolve sweep failed", error.message);
}
