import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { MEDIA_BUCKET } from "./config";
import type { InboundMessage, StatusUpdate, WaMessageStatus } from "./payload";

/**
 * Everything the WhatsApp code needs from the database, behind one small
 * interface so the logic can be unit-tested with an in-memory fake.
 * The Supabase version uses the ADMIN client (webhooks have no user):
 * every query is scoped by restaurant_id explicitly.
 */
export type AccountRecord = {
  id: string;
  restaurantId: string;
  branchId: string | null;
  phoneNumberId: string;
  isActive: boolean;
  accessTokenEncrypted: string;
};

export type ConversationRecord = {
  id: string;
  restaurantId: string;
  waId: string;
  lastCustomerMessageAt: string | null;
  botEnabled: boolean;
};

export type InboundResult = {
  conversationId: string;
  customerId: string | null;
  messageId: string;
  duplicate: boolean;
  botEnabled: boolean;
};

export type OutboundType = "text" | "image" | "document" | "location" | "interactive";

export type OutboundRow = {
  restaurantId: string;
  conversationId: string;
  type?: OutboundType;
  body: string;
  /** For images/documents we send: the https link (kept only if it fits). */
  mediaUrl?: string | null;
  /** Order status messages link to their order. */
  orderId?: string | null;
  status: Extract<WaMessageStatus, "sent" | "failed" | "skipped">;
  waMessageId?: string | null;
  error?: string | null;
};

/** A customer file saved to Storage (or why it wasn't). */
export type MediaResult =
  | { ok: true; path: string; mimeType: string; size: number }
  | { ok: false; error: string };

/** Everything an order status message needs. Admin client: scoped by restaurant_id. */
export type OrderMessageContext = {
  orderNumber: number;
  orderType: "delivery" | "pickup" | "dine_in";
  customerPhone: string | null;
  /** Customer's WhatsApp id (digits) if we know it from a chat. */
  customerWaId: string | null;
  expectedReadyAt: string | null;
  defaultPrepMinutes: number | null;
  cancelReason: string | null;
  /** restaurants.whatsapp_status_messages (status → on/off). */
  statusMessages: Record<string, unknown>;
  /** Assigned rider (Phase 9); phone only when the restaurant shares it with customers. */
  rider?: { name: string; phone: string | null } | null;
};

export interface WhatsAppStore {
  findAccountByPhoneNumberId(phoneNumberId: string): Promise<AccountRecord | null>;
  findAccountByRestaurant(restaurantId: string): Promise<AccountRecord | null>;
  findConversation(restaurantId: string, waId: string): Promise<ConversationRecord | null>;
  /** Atomic + idempotent (same wa_message_id → duplicate: true). */
  recordInbound(restaurantId: string, message: InboundMessage, phoneE164: string | null): Promise<InboundResult>;
  insertOutbound(row: OutboundRow): Promise<string>;
  /** Moves a message forward only (sent → delivered → read). Returns true if a row changed. */
  applyStatus(restaurantId: string, update: StatusUpdate): Promise<boolean>;
  getOrderMessageContext(restaurantId: string, orderId: string): Promise<OrderMessageContext | null>;
  /** Upload to the private media bucket (path = {restaurant_id}/...). */
  uploadMedia(path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  /** Link the stored file (or the download error) to the inbound message. */
  saveMediaResult(restaurantId: string, messageId: string, result: MediaResult): Promise<void>;
}

const MEDIA_URL_MAX = 500;

/** Statuses a message may move FROM to reach each status. */
export const STATUS_FROM: Record<StatusUpdate["status"], WaMessageStatus[]> = {
  sent: [],
  delivered: ["sent"],
  read: ["sent", "delivered"],
  failed: ["sent", "delivered"],
};

type Db = SupabaseClient<Database>;

/** Generated RPC arg types are non-null; SQL NULL is still valid for these params. */
const sqlNull = (value: string | null) => value as string;

function toAccount(row: Database["public"]["Tables"]["whatsapp_accounts"]["Row"]): AccountRecord {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    branchId: row.branch_id,
    phoneNumberId: row.phone_number_id,
    isActive: row.is_active,
    accessTokenEncrypted: row.access_token_encrypted,
  };
}

export function createSupabaseStore(db: Db): WhatsAppStore {
  return {
    async findAccountByPhoneNumberId(phoneNumberId) {
      const { data, error } = await db.from("whatsapp_accounts").select("*").eq("phone_number_id", phoneNumberId).maybeSingle();
      if (error) throw new Error(`account lookup: ${error.message}`);
      return data ? toAccount(data) : null;
    },

    async findAccountByRestaurant(restaurantId) {
      const { data, error } = await db.from("whatsapp_accounts").select("*").eq("restaurant_id", restaurantId).maybeSingle();
      if (error) throw new Error(`account lookup: ${error.message}`);
      return data ? toAccount(data) : null;
    },

    async findConversation(restaurantId, waId) {
      const { data, error } = await db
        .from("whatsapp_conversations")
        .select("id, restaurant_id, wa_id, last_customer_message_at, bot_enabled")
        .eq("restaurant_id", restaurantId)
        .eq("wa_id", waId)
        .maybeSingle();
      if (error) throw new Error(`conversation lookup: ${error.message}`);
      return data
        ? {
            id: data.id,
            restaurantId: data.restaurant_id,
            waId: data.wa_id,
            lastCustomerMessageAt: data.last_customer_message_at,
            botEnabled: data.bot_enabled,
          }
        : null;
    },

    async recordInbound(restaurantId, m, phoneE164) {
      const { data, error } = await db
        .rpc("whatsapp_record_inbound", {
          p_restaurant_id: restaurantId,
          p_wa_id: m.waId,
          p_phone: sqlNull(phoneE164),
          p_profile_name: sqlNull(m.profileName),
          p_wa_message_id: m.waMessageId,
          p_type: m.type,
          p_body: sqlNull(m.body),
          p_media_id: sqlNull(m.mediaId),
          p_raw: m.raw,
          p_sent_at: m.sentAt,
        })
        .single();
      if (error || !data) throw new Error(`record inbound: ${error?.message ?? "no result"}`);
      return {
        conversationId: data.conversation_id,
        customerId: data.customer_id,
        messageId: data.message_id,
        duplicate: data.duplicate,
        botEnabled: data.bot_enabled,
      };
    },

    async insertOutbound(row) {
      const now = new Date().toISOString();
      const { data, error } = await db
        .from("whatsapp_messages")
        .insert({
          restaurant_id: row.restaurantId,
          conversation_id: row.conversationId,
          direction: "outbound",
          type: row.type ?? "text",
          body: row.body.slice(0, 4096),
          media_url: row.mediaUrl && row.mediaUrl.length <= MEDIA_URL_MAX ? row.mediaUrl : null,
          order_id: row.orderId ?? null,
          status: row.status,
          wa_message_id: row.waMessageId ?? null,
          error: row.error?.slice(0, 1000) ?? null,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`save outbound: ${error?.message}`);
      if (row.status === "sent") {
        await db
          .from("whatsapp_conversations")
          .update({ last_message_at: now, last_message_preview: (row.body || `[${row.type ?? "text"}]`).slice(0, 200) })
          .eq("id", row.conversationId)
          .eq("restaurant_id", row.restaurantId);
      }
      return data.id;
    },

    async applyStatus(restaurantId, update) {
      const allowed = STATUS_FROM[update.status];
      if (allowed.length === 0) return false;
      const patch: Database["public"]["Tables"]["whatsapp_messages"]["Update"] = { status: update.status };
      if (update.error) patch.error = update.error;
      const { data, error } = await db
        .from("whatsapp_messages")
        .update(patch)
        .eq("restaurant_id", restaurantId)
        .eq("wa_message_id", update.waMessageId)
        .eq("direction", "outbound")
        .in("status", allowed)
        .select("id");
      if (error) throw new Error(`status update: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },

    async getOrderMessageContext(restaurantId, orderId) {
      const { data: order, error } = await db
        .from("orders")
        .select("order_number, order_type, customer_phone, customer_id, expected_ready_at, cancel_reason, branch_id, rider_id")
        .eq("id", orderId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (error) throw new Error(`order lookup: ${error.message}`);
      if (!order) return null;
      const [restaurant, branch, customer, rider] = await Promise.all([
        db.from("restaurants").select("whatsapp_status_messages, share_rider_phone_with_customer").eq("id", restaurantId).maybeSingle(),
        db.from("branches").select("default_prep_minutes").eq("id", order.branch_id).eq("restaurant_id", restaurantId).maybeSingle(),
        order.customer_id
          ? db.from("customers").select("whatsapp_id").eq("id", order.customer_id).eq("restaurant_id", restaurantId).maybeSingle()
          : Promise.resolve({ data: null }),
        order.rider_id
          ? db.from("rider_profiles").select("name, phone").eq("id", order.rider_id).eq("restaurant_id", restaurantId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const settings = restaurant.data?.whatsapp_status_messages;
      return {
        orderNumber: order.order_number,
        orderType: order.order_type,
        customerPhone: order.customer_phone,
        customerWaId: customer.data?.whatsapp_id ?? null,
        expectedReadyAt: order.expected_ready_at,
        defaultPrepMinutes: branch.data?.default_prep_minutes ?? null,
        cancelReason: order.cancel_reason,
        statusMessages: settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {},
        rider: rider.data
          ? { name: rider.data.name, phone: restaurant.data?.share_rider_phone_with_customer ? rider.data.phone : null }
          : null,
      };
    },

    async uploadMedia(path, bytes, mimeType) {
      const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mimeType, upsert: true });
      if (error) throw new Error(`media upload: ${error.message}`);
    },

    async saveMediaResult(restaurantId, messageId, result) {
      const patch: Database["public"]["Tables"]["whatsapp_messages"]["Update"] = result.ok
        ? { media_url: result.path, media_mime_type: result.mimeType, media_size: result.size, error: null }
        : { error: result.error.slice(0, 1000) };
      const { error } = await db.from("whatsapp_messages").update(patch).eq("id", messageId).eq("restaurant_id", restaurantId);
      if (error) throw new Error(`save media: ${error.message}`);
    },
  };
}
