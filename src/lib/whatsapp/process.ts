import { normalizePhone } from "@/lib/orders/phone";
import { AUTO_REPLY_COOLDOWN_HOURS } from "./config";
import { buildGreeting } from "./greeting";
import { parseWebhookPayload } from "./payload";
import { MEDIA_TYPES, storeInboundMedia } from "./media";
import { createSender, type SenderDeps } from "./send";
import type { AccountRecord } from "./store";

export type ProcessSummary = {
  saved: number;
  media: number;
  duplicates: number;
  statuses: number;
  autoReplies: number;
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

export async function processWebhookPayload(
  deps: SenderDeps,
  payload: unknown,
  log: ProcessLog = () => {},
): Promise<ProcessSummary> {
  const summary: ProcessSummary = { saved: 0, media: 0, duplicates: 0, statuses: 0, autoReplies: 0, ignored: 0, errors: [] };
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const sender = createSender(deps);

  const parsed = parseWebhookPayload(payload);
  summary.errors.push(...parsed.problems);
  log("parsed", { messages: parsed.messages.length, statuses: parsed.statuses.length, problems: parsed.problems.length });

  const accounts = new Map<string, AccountRecord | null>();
  async function account(phoneNumberId: string) {
    if (!accounts.has(phoneNumberId)) accounts.set(phoneNumberId, await store.findAccountByPhoneNumberId(phoneNumberId));
    const found = accounts.get(phoneNumberId);
    return found?.isActive ? found : null;
  }

  /** The temporary greeting (until the Phase 7 bot). Never throws. */
  async function greet(acc: AccountRecord, waId: string, result: { conversationId: string; botEnabled: boolean }) {
    try {
      if (!result.botEnabled) {
        log("auto reply skipped: bot is off for this chat");
        return;
      }
      if (!(await store.claimAutoReply(result.conversationId, AUTO_REPLY_COOLDOWN_HOURS))) {
        log(`auto reply skipped: already greeted in the last ${AUTO_REPLY_COOLDOWN_HOURS}h`);
        return;
      }
      const ctx = await store.getGreetingContext(acc.restaurantId, acc.branchId);
      if (!ctx) {
        log("auto reply skipped: restaurant details not found");
        return;
      }
      const sent = await sender.sendText(acc.restaurantId, waId, buildGreeting(ctx, new Date(now())));
      if (sent.ok) {
        summary.autoReplies++;
        log("auto reply sent", { waMessageId: sent.waMessageId });
      } else {
        summary.errors.push(`auto reply ${sent.status}: ${sent.error}`);
        log(`auto reply ${sent.status}`, { error: sent.error });
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      summary.errors.push(`auto reply: ${text}`);
      log("auto reply FAILED", { error: text });
    }
  }

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

      await greet(acc, message.waId, result);

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
