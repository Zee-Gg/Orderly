import { CUSTOMER_WINDOW_MS, SEND_MAX_RETRIES } from "./config";
import { decryptToken } from "./crypto";
import { postTextMessage, type FetchLike } from "./graph";
import type { WhatsAppStore } from "./store";

/**
 * Outbound WhatsApp messages. No templates in this version, so we may ONLY
 * send inside the 24-hour customer service window.
 * No Next.js imports: usable from webhooks, scripts and tests.
 */
export function isInside24hWindow(
  conversation: { lastCustomerMessageAt: string | null } | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!conversation?.lastCustomerMessageAt) return false;
  const last = Date.parse(conversation.lastCustomerMessageAt);
  if (!Number.isFinite(last)) return false;
  return now - last < CUSTOMER_WINDOW_MS && last - now < 5 * 60_000; // tolerate small clock skew
}

export type SendResult =
  | { ok: true; status: "sent"; messageId: string; waMessageId: string }
  | { ok: false; status: "skipped" | "failed"; messageId: string | null; error: string };

export type SenderDeps = {
  store: WhatsAppStore;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  decrypt?: (stored: string) => string;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createSender(deps: SenderDeps) {
  const fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const decrypt = deps.decrypt ?? ((s: string) => decryptToken(s));

  async function sendText(restaurantId: string, toWaId: string, text: string): Promise<SendResult> {
    const conversation = await deps.store.findConversation(restaurantId, toWaId);
    if (!conversation) {
      // Nothing to attach the message to: the customer never wrote to us.
      return { ok: false, status: "skipped", messageId: null, error: "outside 24h window" };
    }
    const save = (status: "failed" | "skipped", error: string) =>
      deps.store.insertOutbound({ restaurantId, conversationId: conversation.id, body: text, status, error });

    if (!isInside24hWindow(conversation, now())) {
      const messageId = await save("skipped", "outside 24h window");
      return { ok: false, status: "skipped", messageId, error: "outside 24h window" };
    }

    const account = await deps.store.findAccountByRestaurant(restaurantId);
    if (!account || !account.isActive) {
      const messageId = await save("failed", "WhatsApp is not connected");
      return { ok: false, status: "failed", messageId, error: "WhatsApp is not connected" };
    }

    let token: string;
    try {
      token = decrypt(account.accessTokenEncrypted);
    } catch {
      const messageId = await save("failed", "Could not decrypt the access token");
      return { ok: false, status: "failed", messageId, error: "Could not decrypt the access token" };
    }

    let lastError = "Unknown error";
    for (let attempt = 0; attempt <= SEND_MAX_RETRIES; attempt++) {
      if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 0.5s, 1s, 2s
      const res = await postTextMessage(fetchImpl, account.phoneNumberId, token, toWaId, text);
      if (res.ok) {
        const waMessageId = res.data.messages?.[0]?.id;
        if (!waMessageId) {
          lastError = "WhatsApp did not return a message id";
          break;
        }
        const messageId = await deps.store.insertOutbound({
          restaurantId,
          conversationId: conversation.id,
          body: text,
          status: "sent",
          waMessageId,
        });
        return { ok: true, status: "sent", messageId, waMessageId };
      }
      lastError = res.error;
      if (!res.retryable) break;
    }
    const messageId = await save("failed", lastError);
    return { ok: false, status: "failed", messageId, error: lastError };
  }

  return { sendText };
}
