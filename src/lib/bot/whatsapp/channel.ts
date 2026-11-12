import type { SupabaseClient } from "@supabase/supabase-js";
import { addSystemLine } from "@/lib/inbox/system";
import type { Database, Json } from "@/types/database";

/**
 * What the WhatsApp ↔ bot pipeline needs from the database (admin client,
 * always scoped by restaurant_id). No Next.js imports.
 */
type Db = SupabaseClient<Database>;

export type ChannelConversation = {
  id: string;
  restaurantId: string;
  waId: string;
  customerId: string | null;
  botEnabled: boolean;
  botMutedUntil: string | null;
};

export type PendingMessage = {
  id: string;
  /** WhatsApp type, or our own after voice handling: voice | voice_too_long | voice_failed. */
  type: string;
  body: string | null;
  raw: Json;
  createdAt: string;
  /** Storage path of a downloaded voice note / photo (Phase 6B). */
  mediaUrl?: string | null;
  /** Saved transcript of a voice note (Phase 7B). */
  transcript?: string | null;
};

export interface BotChannelStore {
  getConversation(restaurantId: string, conversationId: string): Promise<ChannelConversation | null>;
  /** Newest inbound message of the chat (batching: the newest one handles the batch). */
  newestInboundId(conversationId: string): Promise<string | null>;
  pendingInbound(restaurantId: string, conversationId: string): Promise<PendingMessage[]>;
  isHandled(messageId: string): Promise<boolean>;
  markHandled(messageIds: string[]): Promise<void>;
  countInboundSince(conversationId: string, sinceIso: string): Promise<number>;
  /** One bot turn at a time per chat; the lock expires by itself. */
  claimLock(conversationId: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(conversationId: string): Promise<void>;
  setMuted(conversationId: string, untilIso: string): Promise<void>;
  /** bot_enabled = false + needs_staff + reason → "Needs staff" in the inbox (+ a system line). */
  setHandoff(restaurantId: string, conversationId: string, reason: string): Promise<void>;
  /** A grey line in the inbox chat (never sent to WhatsApp). */
  addSystemLine(restaurantId: string, conversationId: string, text: string, orderId?: string | null): Promise<void>;
  findOpenSessionId(restaurantId: string, conversationId: string): Promise<string | null>;
  /** A downloaded voice note from the private media bucket (null if missing). */
  downloadMedia(path: string): Promise<Uint8Array | null>;
  saveTranscript(messageId: string, transcript: string, provider: string): Promise<void>;
  /** First active branch (when the WhatsApp account has no default branch). */
  defaultBranchId(restaurantId: string): Promise<string | null>;
  /** This month's AI cost (USD) and the restaurant's monthly budget (null = no limit). */
  aiBudget(restaurantId: string, monthStartIso: string): Promise<{ budget: number | null; spent: number }>;
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export function createSupabaseChannelStore(db: Db): BotChannelStore {
  return {
    async getConversation(restaurantId, conversationId) {
      const c = check(
        await db
          .from("whatsapp_conversations")
          .select("id, restaurant_id, wa_id, customer_id, bot_enabled, bot_muted_until")
          .eq("id", conversationId)
          .eq("restaurant_id", restaurantId)
          .maybeSingle(),
        "conversation",
      );
      return c
        ? { id: c.id, restaurantId: c.restaurant_id, waId: c.wa_id, customerId: c.customer_id, botEnabled: c.bot_enabled, botMutedUntil: c.bot_muted_until }
        : null;
    },

    async newestInboundId(conversationId) {
      const r = check(
        await db
          .from("whatsapp_messages")
          .select("id")
          .eq("conversation_id", conversationId)
          .eq("direction", "inbound")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "newest message",
      );
      return r?.id ?? null;
    },

    async pendingInbound(restaurantId, conversationId) {
      const rows = check(
        await db
          .from("whatsapp_messages")
          .select("id, type, body, raw, created_at, media_url, transcript")
          .eq("restaurant_id", restaurantId)
          .eq("conversation_id", conversationId)
          .eq("direction", "inbound")
          .is("bot_handled_at", null)
          .order("created_at")
          .limit(30),
        "pending messages",
      );
      return (rows ?? []).map((m) => ({
        id: m.id,
        type: m.type,
        body: m.body,
        raw: m.raw,
        createdAt: m.created_at,
        mediaUrl: m.media_url,
        transcript: m.transcript,
      }));
    },

    async isHandled(messageId) {
      const r = check(await db.from("whatsapp_messages").select("bot_handled_at").eq("id", messageId).maybeSingle(), "message");
      return !r || r.bot_handled_at !== null;
    },

    async markHandled(ids) {
      if (!ids.length) return;
      check(await db.from("whatsapp_messages").update({ bot_handled_at: new Date().toISOString() }).in("id", ids), "mark handled");
    },

    async countInboundSince(conversationId, sinceIso) {
      const { count, error } = await db
        .from("whatsapp_messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversationId)
        .eq("direction", "inbound")
        .gte("created_at", sinceIso);
      if (error) throw new Error(`count messages: ${error.message}`);
      return count ?? 0;
    },

    async claimLock(conversationId, ttlSeconds) {
      const { data, error } = await db.rpc("bot_claim_conversation", { p_conversation_id: conversationId, p_ttl_seconds: ttlSeconds });
      if (error) throw new Error(`claim lock: ${error.message}`);
      return data === true;
    },

    async releaseLock(conversationId) {
      check(await db.from("whatsapp_conversations").update({ bot_lock_until: null }).eq("id", conversationId), "release lock");
    },

    async setMuted(conversationId, untilIso) {
      check(await db.from("whatsapp_conversations").update({ bot_muted_until: untilIso }).eq("id", conversationId), "mute");
    },

    async setHandoff(restaurantId, conversationId, reason) {
      const now = new Date().toISOString();
      check(
        await db
          .from("whatsapp_conversations")
          .update({
            bot_enabled: false,
            handoff_reason: reason.slice(0, 300),
            handed_off_at: now,
            needs_staff: true,
            needs_staff_since: now,
            status: "open",
            resolved_at: null,
          })
          .eq("id", conversationId)
          .eq("restaurant_id", restaurantId),
        "handoff",
      );
      await addSystemLine(db, restaurantId, conversationId, `Handed to staff: ${reason}`);
    },

    async addSystemLine(restaurantId, conversationId, text, orderId) {
      await addSystemLine(db, restaurantId, conversationId, text, orderId);
    },

    async findOpenSessionId(restaurantId, conversationId) {
      const r = check(
        await db
          .from("bot_sessions")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .eq("conversation_id", conversationId)
          .in("status", ["active", "awaiting_confirmation", "handed_off"])
          .order("last_activity_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "open session",
      );
      return r?.id ?? null;
    },

    async downloadMedia(path) {
      const { data, error } = await db.storage.from("whatsapp-media").download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },

    async saveTranscript(messageId, transcript, provider) {
      check(
        await db.from("whatsapp_messages").update({ transcript: transcript.slice(0, 4000), transcribe_provider: provider }).eq("id", messageId),
        "save transcript",
      );
    },

    async defaultBranchId(restaurantId) {
      const b = check(
        await db.from("branches").select("id").eq("restaurant_id", restaurantId).eq("is_active", true).order("created_at").limit(1).maybeSingle(),
        "branch",
      );
      return b?.id ?? null;
    },

    async aiBudget(restaurantId, monthStartIso) {
      const [r, usage] = await Promise.all([
        db.from("restaurants").select("ai_monthly_budget_usd").eq("id", restaurantId).maybeSingle(),
        db.rpc("ai_usage_summary", { p_since: monthStartIso, p_restaurant_id: restaurantId }),
      ]);
      if (r.error) throw new Error(`budget: ${r.error.message}`);
      if (usage.error) throw new Error(`usage: ${usage.error.message}`);
      const budget = r.data?.ai_monthly_budget_usd;
      return { budget: budget === null || budget === undefined ? null : Number(budget), spent: Number(usage.data?.[0]?.cost ?? 0) };
    },
  };
}
