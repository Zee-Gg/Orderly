import { monthStart } from "@/lib/time";
import { runBotTurn, type AgentDeps, type BotButton, type BotTurnInput } from "../agent";
import { detectLanguage } from "../language";
import { t } from "../texts";
import type { BotLanguage, BotStore } from "../types";
import type { BotChannelStore, PendingMessage } from "./channel";

/**
 * WhatsApp → AI bot → WhatsApp. Runs after the webhook saved an inbound
 * message (in `after()`, never blocking Meta). No Next.js imports.
 *
 *  1. Batching: wait ~4s; if a newer message arrived, that one handles the batch.
 *  2. One bot turn at a time per chat (DB lock, expires after 60s).
 *  3. Skip when the restaurant's bot is off or the chat is with staff.
 *  4. Flood limit: >10 messages a minute → stop replying for a minute (logged).
 *  5. Combine all unhandled messages into ONE runBotTurn; send the reply
 *     (with buttons when the bot asks for them). Handoff → chat goes to staff.
 */
export const BOT_PIPELINE = {
  batchWaitMs: 4_000,
  lockTtlSeconds: 60,
  lockRetryMs: 1_500,
  floodLimit: 10,
  floodWindowMs: 60_000,
  muteMs: 60_000,
  maxTurnsPerRun: 3,
};

export type PipelineSender = {
  sendText(restaurantId: string, toWaId: string, text: string): Promise<{ ok: boolean; error?: string }>;
  sendInteractiveButtons(restaurantId: string, toWaId: string, text: string, buttons: BotButton[]): Promise<{ ok: boolean; error?: string }>;
};

export type PipelineDeps = {
  channel: BotChannelStore;
  botStore: BotStore;
  sender: PipelineSender;
  agent?: Omit<AgentDeps, "store">;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (step: string, details?: Record<string, unknown>) => void;
  config?: Partial<typeof BOT_PIPELINE>;
};

export type BotTrigger = {
  restaurantId: string;
  /** The WhatsApp account's default branch (null = the restaurant's first branch). */
  branchId: string | null;
  conversationId: string;
  /** The inbound message that started this run. */
  messageId: string;
};

const MEDIA_TYPES = new Set(["image", "audio", "document", "unknown"]);
const INTERACTIVE_BODY_MAX = 1024;

type Location = NonNullable<BotTurnInput["location"]>;

/** Turn a batch of saved messages into what runBotTurn needs. */
export function combineMessages(messages: PendingMessage[]): {
  texts: string[];
  buttonId: string | null;
  location: Location | null;
  mediaOnly: boolean;
} {
  const texts: string[] = [];
  let buttonId: string | null = null;
  let location: Location | null = null;
  let media = 0;
  for (const m of messages) {
    const raw = (m.raw ?? {}) as Record<string, unknown>;
    if (m.type === "location") {
      const l = raw.location as { latitude?: number; longitude?: number; name?: string; address?: string } | undefined;
      if (typeof l?.latitude === "number" && typeof l?.longitude === "number") {
        location = { latitude: l.latitude, longitude: l.longitude, name: l.name ?? null, address: l.address ?? null };
        texts.push(`[Customer shared a location pin${l.name || l.address ? `: ${[l.name, l.address].filter(Boolean).join(", ")}` : ""}]`);
      }
      continue;
    }
    if (m.type === "interactive") {
      const reply = (raw.interactive as { button_reply?: { id?: string; title?: string } } | undefined)?.button_reply;
      if (reply?.id) buttonId = reply.id;
      if (m.body) texts.push(m.body);
      continue;
    }
    if (MEDIA_TYPES.has(m.type)) {
      media++;
      if (m.body && m.type !== "unknown") texts.push(m.body); // a photo caption is text the bot can read
      continue;
    }
    buttonId = null; // typing after tapping a button: the typed text wins
    if (m.body?.trim()) texts.push(m.body.trim());
  }
  return { texts, buttonId, location, mediaOnly: media > 0 && texts.length === 0 };
}

export function createBotPipeline(deps: PipelineDeps) {
  const cfg = { ...BOT_PIPELINE, ...deps.config };
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const { channel, botStore, sender } = deps;

  async function languageFor(restaurantId: string, customerId: string | null, sample: string): Promise<BotLanguage> {
    const customer = customerId ? await botStore.getCustomer(restaurantId, customerId) : null;
    return customer?.preferredLanguage ?? detectLanguage(sample) ?? "roman_urdu";
  }

  async function handoff(trigger: BotTrigger, waId: string, reason: string, language: BotLanguage) {
    await channel.setHandoff(trigger.restaurantId, trigger.conversationId, reason);
    log("handed off to staff", { reason });
    await sender.sendText(trigger.restaurantId, waId, t(language).handedOff);
  }

  async function send(restaurantId: string, waId: string, text: string, buttons: BotButton[] | null) {
    if (!buttons?.length) return sender.sendText(restaurantId, waId, text);
    if (text.length <= INTERACTIVE_BODY_MAX) return sender.sendInteractiveButtons(restaurantId, waId, text, buttons);
    // Long summary: the text first, then the buttons with a short line.
    await sender.sendText(restaurantId, waId, text);
    return sender.sendInteractiveButtons(restaurantId, waId, t(detectLanguage(text) ?? "roman_urdu").chooseBelow, buttons);
  }

  /** One batch: returns false when there was nothing (more) to do. */
  async function turn(trigger: BotTrigger): Promise<boolean> {
    const { restaurantId, conversationId } = trigger;
    const pending = await channel.pendingInbound(restaurantId, conversationId);
    if (!pending.length) return false;
    const conv = await channel.getConversation(restaurantId, conversationId);
    const restaurant = await botStore.getRestaurant(restaurantId);
    if (!conv || !restaurant) {
      await channel.markHandled(pending.map((m) => m.id));
      return false;
    }
    // Claim the batch first, so waiting handlers see it is taken.
    await channel.markHandled(pending.map((m) => m.id));

    if (!restaurant.botEnabled || !conv.botEnabled) {
      log("bot skipped: switched off for this restaurant or chat is with staff", { botEnabled: restaurant.botEnabled, chatBot: conv.botEnabled });
      return true;
    }

    // Flood limit.
    if (conv.botMutedUntil && Date.parse(conv.botMutedUntil) > now().getTime()) {
      log("bot skipped: chat muted (flood)", { until: conv.botMutedUntil });
      return true;
    }
    const recent = await channel.countInboundSince(conversationId, new Date(now().getTime() - cfg.floodWindowMs).toISOString());
    if (recent > cfg.floodLimit) {
      const until = new Date(now().getTime() + cfg.muteMs).toISOString();
      await channel.setMuted(conversationId, until);
      log("FLOOD: too many messages, not replying for a minute", { messages: recent });
      await botStore.logTurn({
        restaurantId,
        sessionId: null,
        inputText: pending.map((m) => m.body ?? `[${m.type}]`).join("\n").slice(0, 4000),
        toolCalls: [],
        replyText: null,
        provider: "",
        model: "",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCost: 0,
        latencyMs: 0,
        errorType: "flood",
        error: `${recent} messages in a minute; muted until ${until}`,
      });
      return true;
    }

    const batch = combineMessages(pending);
    const sample = batch.texts.join(" ");
    if (batch.mediaOnly) {
      const language = await languageFor(restaurantId, conv.customerId, sample);
      log("media only: asking the customer to type");
      await sender.sendText(restaurantId, conv.waId, t(language).mediaNotSupported);
      return true;
    }
    if (!batch.texts.length && !batch.location) return true;

    const sessionId = await channel.findOpenSessionId(restaurantId, conversationId);
    // AI budget: a NEW conversation goes straight to staff once this month's budget is used.
    if (!sessionId) {
      const { budget, spent } = await channel.aiBudget(restaurantId, monthStart(restaurant.timezone, now()).toISOString());
      if (budget !== null && spent >= budget) {
        await botStore.logTurn({
          restaurantId,
          sessionId: null,
          inputText: sample.slice(0, 4000),
          toolCalls: [],
          replyText: null,
          provider: "",
          model: "",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCost: 0,
          latencyMs: 0,
          errorType: "budget",
          error: `Monthly AI budget $${budget} reached ($${spent.toFixed(4)} spent)`,
        });
        await handoff(trigger, conv.waId, "Monthly AI budget reached", await languageFor(restaurantId, conv.customerId, sample));
        return true;
      }
    }

    const branchId = trigger.branchId ?? (await channel.defaultBranchId(restaurantId));
    if (!branchId) {
      log("bot skipped: restaurant has no active branch");
      return true;
    }
    const result = await runBotTurn(
      {
        restaurantId,
        branchId,
        sessionId,
        customerId: conv.customerId,
        conversationId,
        customerMessages: batch.texts.length ? batch.texts : ["[Customer shared a location pin]"],
        buttonId: batch.buttonId,
        location: batch.location,
      },
      { store: botStore, ...deps.agent },
    );
    log("bot turn", {
      sessionId: result.sessionId,
      tools: result.toolCalls.map((c) => c.tool),
      stage: result.session.stage,
      buttons: result.showButtons?.map((b) => b.id) ?? [],
      order: result.orderCreated?.orderNumber ?? null,
      handedOff: result.handedOff,
      ms: result.latencyMs,
      error: result.error?.type ?? null,
    });

    if (result.replyText) {
      const sent = await send(restaurantId, conv.waId, result.replyText, result.showButtons);
      if (!sent.ok) log("reply NOT sent", { error: sent.error });
    }
    if (result.handedOff && result.replyText) {
      await channel.setHandoff(restaurantId, conversationId, result.session.handoffReason ?? "Bot handed off to staff");
      log("handed off to staff", { reason: result.session.handoffReason });
    }
    return true;
  }

  /**
   * Called once per saved inbound message. Never throws.
   */
  async function handleInbound(trigger: BotTrigger): Promise<void> {
    try {
      await sleep(cfg.batchWaitMs);
      const newest = await channel.newestInboundId(trigger.conversationId);
      if (newest && newest !== trigger.messageId) {
        log("batching: a newer message will handle this batch");
        return;
      }
      // Wait for any running turn (it may pick our message up), max ~ lock TTL.
      let locked = false;
      for (let i = 0; i < Math.ceil((cfg.lockTtlSeconds * 1000) / cfg.lockRetryMs) + 2; i++) {
        if (await channel.claimLock(trigger.conversationId, cfg.lockTtlSeconds)) {
          locked = true;
          break;
        }
        if (await channel.isHandled(trigger.messageId)) {
          log("another bot turn handled this message");
          return;
        }
        await sleep(cfg.lockRetryMs);
      }
      if (!locked) {
        log("could not get the chat lock; giving up on this message");
        return;
      }
      try {
        // Messages that arrive during a turn are picked up by the next loop.
        for (let i = 0; i < cfg.maxTurnsPerRun; i++) {
          if (!(await turn(trigger))) break;
        }
      } finally {
        await channel.releaseLock(trigger.conversationId);
      }
    } catch (err) {
      log("bot FAILED", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { handleInbound };
}
