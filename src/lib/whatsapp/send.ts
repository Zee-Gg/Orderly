import { z } from "zod";
import { CUSTOMER_WINDOW_MS, SEND_MAX_RETRIES } from "./config";
import { decryptToken } from "./crypto";
import { postMessage, postReadReceipt, type FetchLike } from "./graph";
import type { OutboundType, WhatsAppStore } from "./store";

/**
 * Outbound WhatsApp messages. No templates in this version, so we may ONLY
 * send inside the 24-hour customer service window. Every attempt is saved
 * (sent / failed / skipped) so staff can see what happened.
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

// ---------------------------------------------------------------------------
// What can be sent (limits are Meta's)
// ---------------------------------------------------------------------------

const httpsUrl = z.url({ protocol: /^https$/, error: "Must be an https link" }).max(2000);
const replyButton = z.object({ id: z.string().trim().min(1).max(256), title: z.string().trim().min(1).max(20) });
const listRow = z.object({
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(24),
  description: z.string().trim().max(72).optional(),
});

export const outboundContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1).max(4096) }),
  z.object({ kind: z.literal("image"), url: httpsUrl, caption: z.string().trim().max(1024).optional() }),
  z.object({
    kind: z.literal("document"),
    url: httpsUrl,
    filename: z.string().trim().min(1).max(240),
    caption: z.string().trim().max(1024).optional(),
  }),
  z.object({
    kind: z.literal("location"),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    name: z.string().trim().max(1000).optional(),
    address: z.string().trim().max(1000).optional(),
  }),
  z.object({
    kind: z.literal("buttons"),
    text: z.string().trim().min(1).max(1024),
    buttons: z.array(replyButton).min(1).max(3),
  }),
  z.object({
    kind: z.literal("list"),
    text: z.string().trim().min(1).max(1024),
    buttonText: z.string().trim().min(1).max(20),
    sections: z
      .array(z.object({ title: z.string().trim().max(24).optional(), rows: z.array(listRow).min(1).max(10) }))
      .min(1)
      .max(10)
      .refine((s) => s.reduce((n, x) => n + x.rows.length, 0) <= 10, "A list can have at most 10 rows"),
  }),
]);

export type OutboundContent = z.input<typeof outboundContentSchema>;
type Content = z.output<typeof outboundContentSchema>;

/** The Graph API body part for each kind. */
function toGraphMessage(c: Content): Record<string, unknown> {
  switch (c.kind) {
    case "text":
      return { type: "text", text: { preview_url: false, body: c.text } };
    case "image":
      return { type: "image", image: { link: c.url, ...(c.caption ? { caption: c.caption } : {}) } };
    case "document":
      return { type: "document", document: { link: c.url, filename: c.filename, ...(c.caption ? { caption: c.caption } : {}) } };
    case "location":
      return { type: "location", location: { latitude: c.latitude, longitude: c.longitude, name: c.name, address: c.address } };
    case "buttons":
      return {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: c.text },
          action: { buttons: c.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
        },
      };
    case "list":
      return {
        type: "interactive",
        interactive: { type: "list", body: { text: c.text }, action: { button: c.buttonText, sections: c.sections } },
      };
  }
}

/** What we save in whatsapp_messages (type + readable body for the inbox). */
function toSaved(c: Content): { type: OutboundType; body: string; mediaUrl: string | null } {
  switch (c.kind) {
    case "text":
      return { type: "text", body: c.text, mediaUrl: null };
    case "image":
      return { type: "image", body: c.caption ?? "", mediaUrl: c.url };
    case "document":
      return { type: "document", body: c.caption ? `${c.filename}\n${c.caption}` : c.filename, mediaUrl: c.url };
    case "location":
      return {
        type: "location",
        body: [[c.name, c.address].filter(Boolean).join(", "), `${c.latitude}, ${c.longitude}`].filter(Boolean).join(" · "),
        mediaUrl: null,
      };
    case "buttons":
      return { type: "interactive", body: `${c.text}\n${c.buttons.map((b) => `[${b.title}]`).join(" ")}`, mediaUrl: null };
    case "list":
      return {
        type: "interactive",
        body: `${c.text}\n${c.sections.flatMap((s) => s.rows.map((r) => `• ${r.title}`)).join("\n")}`,
        mediaUrl: null,
      };
  }
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

export const OUTSIDE_WINDOW = "outside 24h window";

export type SendResult =
  | { ok: true; status: "sent"; messageId: string; waMessageId: string }
  | { ok: false; status: "skipped" | "failed"; messageId: string | null; error: string };

export type SendOptions = {
  orderId?: string | null;
  /** Phase 10: staff replies from the inbox (default bot / system for order updates). */
  senderType?: "bot" | "staff" | "system";
  sentByUserId?: string | null;
};

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

  /** Every helper below comes through here: 24h check → send with retries → save. */
  async function send(
    restaurantId: string,
    toWaId: string,
    content: OutboundContent,
    options: SendOptions = {},
  ): Promise<SendResult> {
    const parsed = outboundContentSchema.safeParse(content);
    if (!parsed.success) {
      return { ok: false, status: "failed", messageId: null, error: `Invalid message: ${parsed.error.issues[0]?.message}` };
    }
    const c = parsed.data;
    const saved = toSaved(c);

    const conversation = await deps.store.findConversation(restaurantId, toWaId);
    if (!conversation) {
      // Nothing to attach the message to: the customer never wrote to us.
      return { ok: false, status: "skipped", messageId: null, error: OUTSIDE_WINDOW };
    }
    const save = (status: "sent" | "failed" | "skipped", extra: { error?: string; waMessageId?: string }) =>
      deps.store.insertOutbound({
        restaurantId,
        conversationId: conversation.id,
        type: saved.type,
        body: saved.body,
        mediaUrl: saved.mediaUrl,
        orderId: options.orderId ?? null,
        senderType: options.senderType,
        sentByUserId: options.sentByUserId ?? null,
        content: c as unknown as Record<string, unknown>,
        status,
        ...extra,
      });

    if (!isInside24hWindow(conversation, now())) {
      const messageId = await save("skipped", { error: OUTSIDE_WINDOW });
      return { ok: false, status: "skipped", messageId, error: OUTSIDE_WINDOW };
    }

    const account = await deps.store.findAccountByRestaurant(restaurantId);
    if (!account || !account.isActive) {
      const messageId = await save("failed", { error: "WhatsApp is not connected" });
      return { ok: false, status: "failed", messageId, error: "WhatsApp is not connected" };
    }

    let token: string;
    try {
      token = decrypt(account.accessTokenEncrypted);
    } catch {
      const messageId = await save("failed", { error: "Could not decrypt the access token" });
      return { ok: false, status: "failed", messageId, error: "Could not decrypt the access token" };
    }

    const message = toGraphMessage(c);
    let lastError = "Unknown error";
    for (let attempt = 0; attempt <= SEND_MAX_RETRIES; attempt++) {
      if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 0.5s, 1s, 2s
      const res = await postMessage(fetchImpl, account.phoneNumberId, token, toWaId, message);
      if (res.ok) {
        const waMessageId = res.data.messages?.[0]?.id;
        if (!waMessageId) {
          lastError = "WhatsApp did not return a message id";
          break;
        }
        const messageId = await save("sent", { waMessageId });
        return { ok: true, status: "sent", messageId, waMessageId };
      }
      lastError = res.error;
      if (!res.retryable) break;
    }
    const messageId = await save("failed", { error: lastError });
    return { ok: false, status: "failed", messageId, error: lastError };
  }

  /** Blue ticks: mark the customer's message (and all before it) as read. Never throws. */
  async function markRead(restaurantId: string, waMessageId: string): Promise<boolean> {
    try {
      const account = await deps.store.findAccountByRestaurant(restaurantId);
      if (!account?.isActive) return false;
      const res = await postReadReceipt(fetchImpl, account.phoneNumberId, decrypt(account.accessTokenEncrypted), waMessageId);
      return res.ok;
    } catch {
      return false;
    }
  }

  type Target = [restaurantId: string, toWaId: string];
  return {
    send,
    markRead,
    sendText: (...[r, to, text, options]: [...Target, string, SendOptions?]) => send(r, to, { kind: "text", text }, options),
    sendImage: (...[r, to, url, caption]: [...Target, string, string?]) => send(r, to, { kind: "image", url, caption }),
    sendDocument: (...[r, to, url, filename, caption]: [...Target, string, string, string?]) =>
      send(r, to, { kind: "document", url, filename, caption }),
    sendLocation: (...[r, to, latitude, longitude, name, address]: [...Target, number, number, string?, string?]) =>
      send(r, to, { kind: "location", latitude, longitude, name, address }),
    sendInteractiveButtons: (...[r, to, text, buttons]: [...Target, string, { id: string; title: string }[]]) =>
      send(r, to, { kind: "buttons", text, buttons }),
    sendInteractiveList: (
      ...[r, to, text, buttonText, sections]: [
        ...Target,
        string,
        string,
        { title?: string; rows: { id: string; title: string; description?: string }[] }[],
      ]
    ) => send(r, to, { kind: "list", text, buttonText, sections }),
  };
}
