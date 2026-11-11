import { normalizePhone } from "@/lib/orders/phone";
import { parseWebhookPayload } from "./payload";
import { MEDIA_TYPES, storeInboundMedia } from "./media";
import type { SenderDeps } from "./send";
import type { AccountRecord } from "./store";

export type ProcessSummary = {
  saved: number;
  media: number;
  duplicates: number;
  statuses: number;
  /** Conversations handed to the AI bot. */
  botRuns: number;
  ignored: number;
  errors: string[];
};

/**
 * Handle one webhook delivery (already signature-checked and logged).
 * Never throws: every problem is collected into `errors` so the caller can
 * store it on the webhook event row, and one bad item never blocks the rest.
 */
export type ProcessLog = (step: string, details?: Record<string, unknown>) => void;

/** Step-by-step console logs (no message text, no tokens). Tests pass nothing → silent. */
export const consoleProcessLog: ProcessLog = (step, details) =>
  console.log(`[whatsapp] ${step}`, details ? JSON.stringify(details) : "");

/** The AI bot (Phase 7A-2): called once per conversation with its newest saved message. */
export type InboundHook = (input: {
  restaurantId: string;
  branchId: string | null;
  conversationId: string;
  messageId: string;
}) => Promise<void>;

export async function processWebhookPayload(
  deps: SenderDeps & { onInbound?: InboundHook },
  payload: unknown,
  log: ProcessLog = () => {},
): Promise<ProcessSummary> {
  const summary: ProcessSummary = { saved: 0, media: 0, duplicates: 0, statuses: 0, botRuns: 0, ignored: 0, errors: [] };
  const { store } = deps;

  const parsed = parseWebhookPayload(payload);
  summary.errors.push(...parsed.problems);
  log("parsed", { messages: parsed.messages.length, statuses: parsed.statuses.length, problems: parsed.problems.length });

  const accounts = new Map<string, AccountRecord | null>();
  async function account(phoneNumberId: string) {
    if (!accounts.has(phoneNumberId)) accounts.set(phoneNumberId, await store.findAccountByPhoneNumberId(phoneNumberId));
    const found = accounts.get(phoneNumberId);
    return found?.isActive ? found : null;
  }

  // Newest saved message per conversation → one bot run each (batching).
  const latest = new Map<string, { account: AccountRecord; messageId: string }>();

  for (const message of parsed.messages) {
    try {
      const acc = await account(message.phoneNumberId);
      if (!acc) {
        summary.ignored++; // a number we don't know (or disconnected)
        const why = `no connected restaurant for phone_number_id ${message.phoneNumberId}`;
        summary.errors.push(`ignored message ${message.waMessageId}: ${why}`);
        log("restaurant NOT found, message ignored", { phoneNumberId: message.phoneNumberId });
        continue;
      }
      log("restaurant found", { restaurantId: acc.restaurantId, phoneNumberId: message.phoneNumberId, type: message.type });
      const phone = normalizePhone(`+${message.waId}`);
      const result = await store.recordInbound(acc.restaurantId, message, phone);
      log("customer saved", { customerId: result.customerId, conversationId: result.conversationId });
      if (result.duplicate) {
        summary.duplicates++;
        log("message is a duplicate (Meta retry), skipped", { waMessageId: message.waMessageId });
        continue; // Meta retry: never reply twice
      }
      summary.saved++;
      log("message saved", { messageId: result.messageId, waMessageId: message.waMessageId });

      latest.set(result.conversationId, { account: acc, messageId: result.messageId });

      if (message.mediaId && MEDIA_TYPES.has(message.type)) {
        const media = await storeInboundMedia(deps, acc, result.messageId, message.mediaId);
        if (media.ok) {
          summary.media++;
          log("media saved", { path: media.path, bytes: media.size });
        } else {
          summary.errors.push(`media ${message.waMessageId}: ${media.error}`);
          log("media NOT saved", { error: media.error });
        }
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      summary.errors.push(`message ${message.waMessageId}: ${text}`);
      log("message FAILED", { waMessageId: message.waMessageId, error: text });
    }
  }

  if (deps.onInbound && latest.size) {
    await Promise.all(
      [...latest].map(async ([conversationId, { account, messageId }]) => {
        try {
          await deps.onInbound!({ restaurantId: account.restaurantId, branchId: account.branchId, conversationId, messageId });
          summary.botRuns++;
        } catch (err) {
          summary.errors.push(`bot: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
  }

  for (const status of parsed.statuses) {
    try {
      const acc = await account(status.phoneNumberId);
      if (!acc) {
        summary.ignored++;
        continue;
      }
      const applied = await store.applyStatus(acc.restaurantId, status);
      if (applied) summary.statuses++;
      log(applied ? "status updated" : "status ignored (old or unknown message)", { waMessageId: status.waMessageId, status: status.status });
    } catch (err) {
      summary.errors.push(`status ${status.waMessageId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return summary;
}
