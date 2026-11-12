import {
  STATUS_FROM,
  type AccountRecord,
  type OrderMessageContext,
  type WhatsAppStore,
} from "./store";
import type { WaMessageStatus } from "./payload";

/**
 * In-memory WhatsAppStore for unit tests. Mirrors the database rules that
 * matter for the logic: wa_message_id is unique, statuses only move forward,
 * the auto-reply claim has a cooldown.
 */
export type MemoryMessage = {
  id: string;
  restaurantId: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  waMessageId: string | null;
  type: string;
  body: string | null;
  mediaId: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaSize: number | null;
  orderId: string | null;
  senderType?: string;
  sentByUserId?: string | null;
  status: WaMessageStatus;
  error: string | null;
};

export function createMemoryStore(
  seed: {
    accounts?: AccountRecord[];
    orders?: Record<string, OrderMessageContext>;
    now?: () => number;
  } = {},
) {
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;
  const accounts = [...(seed.accounts ?? [])];
  const conversations: {
    id: string;
    restaurantId: string;
    waId: string;
    customerId: string | null;
    lastCustomerMessageAt: string | null;
    lastAutoReplyAt: number | null;
    botEnabled: boolean;
  }[] = [];
  const customers: { id: string; restaurantId: string; phone: string; name: string | null }[] = [];
  const messages: MemoryMessage[] = [];
  const files = new Map<string, { bytes: Uint8Array; mimeType: string }>();

  const store: WhatsAppStore = {
    async findAccountByPhoneNumberId(phoneNumberId) {
      return accounts.find((a) => a.phoneNumberId === phoneNumberId) ?? null;
    },
    async findAccountByRestaurant(restaurantId) {
      return accounts.find((a) => a.restaurantId === restaurantId) ?? null;
    },
    async findConversation(restaurantId, waId) {
      const c = conversations.find((x) => x.restaurantId === restaurantId && x.waId === waId);
      return c ? { id: c.id, restaurantId, waId, lastCustomerMessageAt: c.lastCustomerMessageAt, botEnabled: c.botEnabled } : null;
    },
    async recordInbound(restaurantId, m, phone) {
      const existing = messages.find((x) => x.waMessageId === m.waMessageId);
      if (existing) {
        const c = conversations.find((x) => x.id === existing.conversationId)!;
        return { conversationId: c.id, customerId: c.customerId, messageId: existing.id, duplicate: true, botEnabled: c.botEnabled };
      }
      let customer = phone ? customers.find((x) => x.restaurantId === restaurantId && x.phone === phone) : undefined;
      if (phone && !customer) {
        customer = { id: id("cust"), restaurantId, phone, name: m.profileName };
        customers.push(customer);
      } else if (customer && !customer.name) customer.name = m.profileName;
      let c = conversations.find((x) => x.restaurantId === restaurantId && x.waId === m.waId);
      if (!c) {
        c = { id: id("conv"), restaurantId, waId: m.waId, customerId: customer?.id ?? null, lastCustomerMessageAt: null, lastAutoReplyAt: null, botEnabled: true };
        conversations.push(c);
      }
      if (!c.lastCustomerMessageAt || m.sentAt > c.lastCustomerMessageAt) c.lastCustomerMessageAt = m.sentAt;
      const msg: MemoryMessage = {
        id: id("msg"), restaurantId, conversationId: c.id, direction: "inbound",
        waMessageId: m.waMessageId, type: m.type, body: m.body, mediaId: m.mediaId, mediaUrl: null, mediaMimeType: null,
        mediaSize: null, orderId: null, status: "received", error: null,
      };
      messages.push(msg);
      return { conversationId: c.id, customerId: c.customerId, messageId: msg.id, duplicate: false, botEnabled: c.botEnabled };
    },
    async insertOutbound(row) {
      if (row.waMessageId && messages.some((x) => x.waMessageId === row.waMessageId)) throw new Error("duplicate wa_message_id");
      const msg: MemoryMessage = {
        id: id("msg"), restaurantId: row.restaurantId, conversationId: row.conversationId, direction: "outbound",
        waMessageId: row.waMessageId ?? null, type: row.type ?? "text", body: row.body, mediaId: null,
        mediaUrl: row.mediaUrl ?? null, mediaMimeType: null, mediaSize: null, orderId: row.orderId ?? null,
        status: row.status, error: row.error ?? null,
        senderType: row.senderType ?? (row.orderId ? "system" : "bot"), sentByUserId: row.sentByUserId ?? null,
      };
      messages.push(msg);
      return msg.id;
    },
    async applyStatus(restaurantId, update) {
      const msg = messages.find(
        (x) => x.restaurantId === restaurantId && x.waMessageId === update.waMessageId && x.direction === "outbound",
      );
      if (!msg || !STATUS_FROM[update.status].includes(msg.status)) return false;
      msg.status = update.status;
      if (update.error) msg.error = update.error;
      return true;
    },
    async getOrderMessageContext(_restaurantId, orderId) {
      return seed.orders?.[orderId] ?? null;
    },
    async uploadMedia(path, bytes, mimeType) {
      files.set(path, { bytes, mimeType });
    },
    async saveMediaResult(restaurantId, messageId, result) {
      const msg = messages.find((x) => x.id === messageId && x.restaurantId === restaurantId);
      if (!msg) return;
      if (result.ok) Object.assign(msg, { mediaUrl: result.path, mediaMimeType: result.mimeType, mediaSize: result.size });
      else msg.error = result.error;
    },
  };

  return { store, accounts, conversations, customers, messages, files };
}
