"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, type ActionResult } from "@/lib/action-result";
import type { Action } from "@/lib/auth/permissions";
import { requirePermission, type CurrentContext } from "@/lib/auth/session";
import { createSupabaseBotStore } from "@/lib/bot/store";
import { t } from "@/lib/bot/texts";
import { menuPageUrl, siteUrl } from "@/lib/menu-page/links";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { whatsappSender } from "@/lib/whatsapp/server";
import type { OutboundContent } from "@/lib/whatsapp/send";
import { BOT_MAX_MENU_IMAGES, BOT_MEDIA_BUCKET } from "@/lib/bot/media-constants";
import {
  getConversationDetail,
  getInboxSettings,
  listConversations,
  listQuickReplies,
  listStaff,
  sweepAutoResolve,
  type ConversationDetail,
  type InboxConversation,
  type InboxSettings,
  type StaffMember,
} from "./queries";
import { replyWindow } from "./rules";
import { addSystemLine } from "./system";

/**
 * Inbox actions (Phase 10). Permission check FIRST; conversations and
 * messages have no browser write grants, so writes use the admin client
 * scoped to the member's restaurant. Every customer message goes through the
 * Phase 6 send helpers (24-hour window, retries, saved). Staff sending takes
 * the chat over from the bot.
 */
const uuid = z.uuid();

type Admin = ReturnType<typeof createAdminClient>;

async function staffName(ctx: CurrentContext) {
  const db = await createClient();
  const { data } = await db.from("profiles").select("full_name").eq("id", ctx.user.id).maybeSingle();
  return data?.full_name || "Staff";
}

async function loadConversation(admin: Admin, ctx: CurrentContext, conversationId: string) {
  if (!uuid.safeParse(conversationId).success) return null;
  const { data } = await admin
    .from("whatsapp_conversations")
    .select("id, wa_id, bot_enabled, status, needs_staff, assigned_to, last_customer_message_at, customer_id")
    .eq("id", conversationId)
    .eq("restaurant_id", ctx.restaurant.id)
    .maybeSingle();
  return data;
}

async function guard<T>(action: Action, fn: (ctx: CurrentContext, admin: Admin) => Promise<ActionResult<T>>, fallback: string): Promise<ActionResult<T>> {
  try {
    const ctx = await requirePermission(action);
    const result = await fn(ctx, createAdminClient());
    if (result.ok) revalidatePath("/inbox");
    return result;
  } catch (err) {
    return failure(err, fallback);
  }
}

// ---------------------------------------------------------------------------
// Reads (live refresh)
// ---------------------------------------------------------------------------

export async function fetchInboxAction(search = ""): Promise<{ conversations: InboxConversation[]; staff: StaffMember[]; settings: InboxSettings } | null> {
  try {
    const ctx = await requirePermission("inbox.access");
    await sweepAutoResolve(ctx.restaurant.id);
    const [conversations, staff, settings] = await Promise.all([listConversations(ctx, search.slice(0, 60)), listStaff(ctx), getInboxSettings(ctx)]);
    return { conversations, staff, settings };
  } catch {
    return null;
  }
}

export async function fetchConversationAction(conversationId: string): Promise<ConversationDetail | null> {
  try {
    const ctx = await requirePermission("inbox.access");
    if (!uuid.safeParse(conversationId).success) return null;
    return getConversationDetail(ctx, conversationId, await listStaff(ctx));
  } catch {
    return null;
  }
}

export async function fetchQuickRepliesAction() {
  const ctx = await requirePermission("inbox.access");
  return listQuickReplies(ctx);
}

/** Opening a chat: unread → 0 and blue ticks on WhatsApp. */
export async function markReadAction(conversationId: string): Promise<ActionResult> {
  return guard(
    "inbox.access",
    async (ctx, admin) => {
      const conv = await loadConversation(admin, ctx, conversationId);
      if (!conv) return { ok: false, error: "Chat not found." };
      await admin.from("whatsapp_conversations").update({ unread_count: 0 }).eq("id", conv.id);
      const { data: last } = await admin
        .from("whatsapp_messages")
        .select("wa_message_id")
        .eq("conversation_id", conv.id)
        .eq("direction", "inbound")
        .not("wa_message_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last?.wa_message_id) await whatsappSender().markRead(ctx.restaurant.id, last.wa_message_id);
      return { ok: true };
    },
    "Couldn't mark as read.",
  );
}

// ---------------------------------------------------------------------------
// Sending (staff → customer). Sending takes the chat over from the bot.
// ---------------------------------------------------------------------------

async function takeOver(admin: Admin, ctx: CurrentContext, conv: NonNullable<Awaited<ReturnType<typeof loadConversation>>>, silent = false) {
  const wasBot = conv.bot_enabled;
  await admin
    .from("whatsapp_conversations")
    .update({
      bot_enabled: false,
      needs_staff: false,
      needs_staff_since: null,
      status: "open",
      resolved_at: null,
      assigned_to: conv.assigned_to ?? ctx.user.id,
    })
    .eq("id", conv.id);
  if (wasBot && !silent) await addSystemLine(admin, ctx.restaurant.id, conv.id, `${await staffName(ctx)} took over — bot paused`);
}

async function staffSend(ctx: CurrentContext, admin: Admin, conversationId: string, contents: OutboundContent[]): Promise<ActionResult> {
  const conv = await loadConversation(admin, ctx, conversationId);
  if (!conv) return { ok: false, error: "Chat not found." };
  if (!replyWindow(conv.last_customer_message_at).open) {
    return { ok: false, error: "The customer must message first — WhatsApp only allows replies within 24 hours of their last message." };
  }
  await takeOver(admin, ctx, conv);
  const sender = whatsappSender();
  for (const content of contents) {
    const r = await sender.send(ctx.restaurant.id, conv.wa_id, content, { senderType: "staff", sentByUserId: ctx.user.id });
    if (!r.ok) return { ok: false, error: r.status === "skipped" ? "Outside the 24-hour window — not sent." : `Not sent: ${r.error}` };
  }
  return { ok: true };
}

const textSchema = z.object({ conversationId: uuid, text: z.string().trim().min(1, "Type a message").max(4096) });

export async function sendTextAction(input: z.input<typeof textSchema>): Promise<ActionResult> {
  return guard(
    "inbox.reply",
    async (ctx, admin) => {
      const parsed = textSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Type a message" };
      return staffSend(ctx, admin, parsed.data.conversationId, [{ kind: "text", text: parsed.data.text }]);
    },
    "Couldn't send. Check your internet.",
  );
}

const imageSchema = z.object({ conversationId: uuid, url: z.url(), caption: z.string().trim().max(1024).optional().default("") });

/** An image uploaded with /api/inbox/upload (public bot-media URL of THIS restaurant only). */
export async function sendImageAction(input: z.input<typeof imageSchema>): Promise<ActionResult> {
  return guard(
    "inbox.reply",
    async (ctx, admin) => {
      const parsed = imageSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "Upload the photo again." };
      const prefix = admin.storage.from(BOT_MEDIA_BUCKET).getPublicUrl(`${ctx.restaurant.id}/inbox/`).data.publicUrl;
      if (!parsed.data.url.startsWith(prefix)) return { ok: false, error: "Upload the photo again." };
      return staffSend(ctx, admin, parsed.data.conversationId, [{ kind: "image", url: parsed.data.url, caption: parsed.data.caption || undefined }]);
    },
    "Couldn't send the photo.",
  );
}

async function branchForChat(admin: Admin, ctx: CurrentContext) {
  const { data: acc } = await admin.from("whatsapp_accounts").select("branch_id").eq("restaurant_id", ctx.restaurant.id).maybeSingle();
  return acc?.branch_id ?? ctx.branches[0]?.id ?? null;
}

/** Same as the bot's send_menu: menu images (first with the price note) or the PDF, then the menu page link. */
export async function sendMenuAction(conversationId: string): Promise<ActionResult> {
  return guard(
    "inbox.reply",
    async (ctx, admin) => {
      const branchId = await branchForChat(admin, ctx);
      if (!branchId) return { ok: false, error: "Add a branch first." };
      const media = await createSupabaseBotStore(admin).getMenuMedia(ctx.restaurant.id, branchId);
      const tx = t("roman_urdu");
      const images = media.filter((m) => m.type === "image").slice(0, BOT_MAX_MENU_IMAGES);
      const pdf = media.find((m) => m.type === "pdf");
      const link: OutboundContent = { kind: "text", text: tx.menuPageLink(menuPageUrl(ctx.restaurant.slug, null, siteUrl())) };
      const contents: OutboundContent[] = images.length
        ? [...images.map((m, i): OutboundContent => ({ kind: "image", url: m.url, caption: i === 0 ? tx.menuCaption : undefined })), link]
        : pdf
          ? [link, { kind: "document", url: pdf.url, filename: pdf.fileName ?? "menu.pdf", caption: tx.menuCaption }]
          : [link];
      return staffSend(ctx, admin, conversationId, contents);
    },
    "Couldn't send the menu.",
  );
}

export async function sendMenuLinkAction(conversationId: string): Promise<ActionResult> {
  return guard(
    "inbox.reply",
    async (ctx, admin) =>
      staffSend(ctx, admin, conversationId, [{ kind: "text", text: t("roman_urdu").menuPageLink(menuPageUrl(ctx.restaurant.slug, null, siteUrl())) }]),
    "Couldn't send the link.",
  );
}

/** The branch location pin (or the address as text when there is no pin). */
export async function sendLocationAction(conversationId: string): Promise<ActionResult> {
  return guard(
    "inbox.reply",
    async (ctx, admin) => {
      const branchId = await branchForChat(admin, ctx);
      if (!branchId) return { ok: false, error: "Add a branch first." };
      const { data: b } = await admin.from("branches").select("name, address, area, latitude, longitude").eq("id", branchId).single();
      const name = `${ctx.restaurant.name}${b?.name ? ` — ${b.name}` : ""}`;
      const address = [b?.address, b?.area].filter(Boolean).join(", ");
      if (b?.latitude != null && b.longitude != null) {
        return staffSend(ctx, admin, conversationId, [{ kind: "location", latitude: b.latitude, longitude: b.longitude, name, address: address || name }]);
      }
      if (!address) return { ok: false, error: "Set the branch address or pin in Bot knowledge → Restaurant info." };
      return staffSend(ctx, admin, conversationId, [{ kind: "text", text: `📍 ${name}\n${address}` }]);
    },
    "Couldn't send the location.",
  );
}

/** Send a failed message again (same content). */
export async function retryMessageAction(messageId: string): Promise<ActionResult> {
  return guard(
    "inbox.reply",
    async (ctx, admin) => {
      if (!uuid.safeParse(messageId).success) return { ok: false, error: "Message not found." };
      const { data: m } = await admin
        .from("whatsapp_messages")
        .select("conversation_id, raw, status, direction")
        .eq("id", messageId)
        .eq("restaurant_id", ctx.restaurant.id)
        .maybeSingle();
      const raw = m?.raw as OutboundContent | null;
      if (!m || m.direction !== "outbound" || m.status !== "failed" || !raw || !["text", "image", "document", "location"].includes(raw.kind)) {
        return { ok: false, error: "This message can't be sent again." };
      }
      return staffSend(ctx, admin, m.conversation_id, [raw]);
    },
    "Couldn't send again.",
  );
}

// ---------------------------------------------------------------------------
// Bot / staff control
// ---------------------------------------------------------------------------

export async function takeOverAction(conversationId: string): Promise<ActionResult> {
  return guard(
    "inbox.bot_toggle",
    async (ctx, admin) => {
      const conv = await loadConversation(admin, ctx, conversationId);
      if (!conv) return { ok: false, error: "Chat not found." };
      await takeOver(admin, ctx, { ...conv, bot_enabled: true }, false);
      return { ok: true, message: "You are chatting. The bot is paused for this customer." };
    },
    "Couldn't take over.",
  );
}

/** Bot back on. It sends nothing until the customer's next message. */
export async function handBackAction(conversationId: string): Promise<ActionResult> {
  return guard(
    "inbox.bot_toggle",
    async (ctx, admin) => {
      const conv = await loadConversation(admin, ctx, conversationId);
      if (!conv) return { ok: false, error: "Chat not found." };
      await admin
        .from("whatsapp_conversations")
        .update({ bot_enabled: true, needs_staff: false, needs_staff_since: null, handoff_reason: null, handed_off_at: null, bot_muted_until: null })
        .eq("id", conv.id);
      // A handed-off bot session ends; the next customer message starts fresh.
      await admin.from("bot_sessions").update({ status: "abandoned", stage: "done" }).eq("restaurant_id", ctx.restaurant.id).eq("conversation_id", conv.id).eq("status", "handed_off");
      await addSystemLine(admin, ctx.restaurant.id, conv.id, `Bot turned back on by ${await staffName(ctx)}`);
      return { ok: true, message: "The bot will answer the customer's next message." };
    },
    "Couldn't turn the bot back on.",
  );
}

/** Resolve: done, not needs-staff, bot back on. */
export async function resolveAction(conversationId: string): Promise<ActionResult> {
  return guard(
    "inbox.bot_toggle",
    async (ctx, admin) => {
      const conv = await loadConversation(admin, ctx, conversationId);
      if (!conv) return { ok: false, error: "Chat not found." };
      await admin
        .from("whatsapp_conversations")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          needs_staff: false,
          needs_staff_since: null,
          bot_enabled: true,
          handoff_reason: null,
          handed_off_at: null,
          unread_count: 0,
        })
        .eq("id", conv.id);
      await admin.from("bot_sessions").update({ status: "abandoned", stage: "done" }).eq("restaurant_id", ctx.restaurant.id).eq("conversation_id", conv.id).eq("status", "handed_off");
      await addSystemLine(admin, ctx.restaurant.id, conv.id, `Resolved by ${await staffName(ctx)} — bot is back on`);
      return { ok: true, message: "Chat resolved" };
    },
    "Couldn't resolve.",
  );
}

export async function assignAction(input: { conversationId: string; userId: string | null }): Promise<ActionResult> {
  return guard(
    "inbox.access",
    async (ctx, admin) => {
      const conv = await loadConversation(admin, ctx, input.conversationId);
      if (!conv) return { ok: false, error: "Chat not found." };
      const staff = await listStaff(ctx);
      const target = input.userId ? staff.find((s) => s.id === input.userId) : null;
      if (input.userId && !target) return { ok: false, error: "Choose a staff member." };
      await admin.from("whatsapp_conversations").update({ assigned_to: target?.id ?? null }).eq("id", conv.id);
      await addSystemLine(admin, ctx.restaurant.id, conv.id, target ? `Assigned to ${target.name} by ${await staffName(ctx)}` : `Unassigned by ${await staffName(ctx)}`);
      return { ok: true };
    },
    "Couldn't assign.",
  );
}

export async function setTagsAction(input: { conversationId: string; tags: string[] }): Promise<ActionResult> {
  return guard(
    "inbox.access",
    async (ctx, admin) => {
      const parsed = z.array(z.string().trim().min(1).max(30)).max(10).safeParse(input.tags);
      if (!parsed.success) return { ok: false, error: "Up to 10 short tags." };
      const conv = await loadConversation(admin, ctx, input.conversationId);
      if (!conv) return { ok: false, error: "Chat not found." };
      await admin.from("whatsapp_conversations").update({ tags: [...new Set(parsed.data)] }).eq("id", conv.id);
      return { ok: true };
    },
    "Couldn't save the tags.",
  );
}

export async function addNoteAction(input: { conversationId: string; body: string }): Promise<ActionResult> {
  return guard(
    "inbox.access",
    async (ctx, admin) => {
      const body = z.string().trim().min(1, "Write a note").max(1000).safeParse(input.body);
      if (!body.success) return { ok: false, error: body.error.issues[0]?.message ?? "Write a note" };
      const conv = await loadConversation(admin, ctx, input.conversationId);
      if (!conv) return { ok: false, error: "Chat not found." };
      // User client: RLS checks the member and that the note is theirs.
      const db = await createClient();
      const { error } = await db.from("conversation_notes").insert({ restaurant_id: ctx.restaurant.id, conversation_id: conv.id, user_id: ctx.user.id, body: body.data });
      if (error) throw error;
      return { ok: true };
    },
    "Couldn't save the note.",
  );
}

/** Edit the customer's name from the panel. */
export async function renameCustomerAction(input: { customerId: string; name: string }): Promise<ActionResult> {
  return guard(
    "customers.edit",
    async (ctx) => {
      const parsed = z.object({ customerId: uuid, name: z.string().trim().min(1).max(120) }).safeParse(input);
      if (!parsed.success) return { ok: false, error: "Enter a name." };
      const db = await createClient();
      const { error } = await db.from("customers").update({ name: parsed.data.name }).eq("id", parsed.data.customerId).eq("restaurant_id", ctx.restaurant.id);
      if (error) throw error;
      return { ok: true };
    },
    "Couldn't save the name.",
  );
}

/** Customer tags (Regular, VIP, Problem…) from the panel. */
export async function setCustomerTagsAction(input: { customerId: string; tags: string[] }): Promise<ActionResult> {
  return guard(
    "customers.edit",
    async (ctx) => {
      const parsed = z.object({ customerId: uuid, tags: z.array(z.string().trim().min(1).max(30)).max(20) }).safeParse(input);
      if (!parsed.success) return { ok: false, error: "Up to 20 short tags." };
      const db = await createClient();
      const { error } = await db.from("customers").update({ tags: [...new Set(parsed.data.tags)] }).eq("id", parsed.data.customerId).eq("restaurant_id", ctx.restaurant.id);
      if (error) throw error;
      return { ok: true };
    },
    "Couldn't save the tags.",
  );
}
