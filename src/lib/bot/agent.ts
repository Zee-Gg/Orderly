import { APICallError, generateText, isStepCount, RetryError, type LanguageModel, type ModelMessage, type SystemModelMessage } from "ai";
import { computeStage } from "./cart";
import { activeProvider, BOT_LIMITS, estimateCost, SUPPORTS_CACHE_CONTROL, type AiProvider } from "./config";
import { detectLanguage } from "./language";
import { buildMenuIndex, scrubRefs, type MenuIndex } from "./menu-index";
import { getModel } from "./model";
import { dynamicPrompt, staticPrompt } from "./prompt";
import { t } from "./texts";
import { createAiTools, runTool, type BotContext, type ToolCallLog } from "./tools";
import type { BotSession, BotStore, CustomerInfo } from "./types";

/**
 * One customer turn: load state → (rules that need no AI) → model + tools
 * loop → reply chosen by code where it matters (summary, confirmation) →
 * save session → log to ai_logs. Never throws for AI problems: the customer
 * gets a friendly fallback and the chat is handed to staff.
 * No Next.js imports (used by the playground, scripts, tests, and later WhatsApp).
 */

export type BotButton = { id: string; title: string };

export type BotTurnInput = {
  restaurantId: string;
  branchId: string;
  /** Existing session, or null to start one (needs customerId). */
  sessionId: string | null;
  customerId: string | null;
  conversationId?: string | null;
  /** One or more messages sent in a row (split lines are joined). */
  customerMessages: string[];
  /** Set when the customer tapped a button (confirm, cancel, …). */
  buttonId?: string | null;
  /** A WhatsApp location pin: saved as the delivery location before the AI runs. */
  location?: { latitude: number; longitude: number; name?: string | null; address?: string | null } | null;
  /** Some of the messages are voice-note transcripts (lines starting with "[voice note]"). */
  voice?: boolean;
  /** A voice note that couldn't be understood (no AI: counts as "not understood"). */
  voiceFailed?: boolean;
};

export type BotTurnResult = {
  sessionId: string;
  replyText: string | null;
  showButtons: BotButton[] | null;
  orderCreated: { id: string; orderNumber: number } | null;
  handedOff: boolean;
  session: BotSession;
  toolCalls: ToolCallLog[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  estimatedCost: number;
  latencyMs: number;
  provider: AiProvider;
  model: string;
  error: { type: "rate_limit" | "timeout" | "error"; message: string } | null;
};

export type AgentDeps = {
  store: BotStore;
  provider?: AiProvider;
  /** Override for tests (e.g. MockLanguageModelV4). */
  model?: { model: LanguageModel; modelId: string };
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

const OPEN_STATUSES = new Set(["active", "awaiting_confirmation", "handed_off"]);

/** Buttons with exactly one meaning: code runs the tool, then the AI asks the next question. */
const BUTTON_TOOLS: Record<string, { tool: string; input: Record<string, string> }> = {
  order_type_delivery: { tool: "set_order_type", input: { order_type: "delivery" } },
  order_type_pickup: { tool: "set_order_type", input: { order_type: "pickup" } },
  payment_cod: { tool: "set_payment_method", input: { payment_method: "cod" } },
  payment_card: { tool: "set_payment_method", input: { payment_method: "card_on_delivery" } },
};
const MAX_TRANSCRIPT = 40;

export function isRateLimitError(err: unknown): boolean {
  const e = err instanceof RetryError ? err.lastError : err;
  if (APICallError.isInstance(e) && e.statusCode === 429) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /\b429\b|rate.?limit|RESOURCE_EXHAUSTED|quota|too many requests/i.test(msg);
}

/** Provider busy (503 / "high demand" / overloaded): worth one retry, like a rate limit. */
export function isOverloadedError(err: unknown): boolean {
  const e = err instanceof RetryError ? err.lastError : err;
  if (APICallError.isInstance(e) && (e.statusCode === 503 || e.statusCode === 529)) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /high demand|overloaded|UNAVAILABLE|503|529/i.test(msg);
}

function isTimeoutError(err: unknown): boolean {
  const e = err instanceof Error ? err : null;
  return !!e && (e.name === "TimeoutError" || e.name === "AbortError" || /timed? ?out|aborted/i.test(e.message));
}

function buttonsFor(session: BotSession, lang: BotSession["language"]): BotButton[] | null {
  const b = t(lang).buttons;
  if (session.status === "handed_off" || session.stage === "done") return null;
  switch (session.stage) {
    case "awaiting_confirmation":
      return [
        { id: "confirm", title: b.confirm },
        { id: "change", title: b.change },
        { id: "cancel", title: b.cancel },
      ];
    case "choosing_order_type":
      return [
        { id: "order_type_delivery", title: b.delivery },
        { id: "order_type_pickup", title: b.pickup },
      ];
    case "choosing_payment":
      return [
        { id: "payment_cod", title: b.cod },
        { id: "payment_card", title: b.card },
      ];
    default:
      return null;
  }
}

/** Starts a fresh session for a customer (playground "reset", new WhatsApp chat). */
export async function startSession(
  store: BotStore,
  input: { restaurantId: string; branchId: string; customerId: string | null; conversationId?: string | null },
): Promise<BotSession> {
  const customer = input.customerId ? await store.getCustomer(input.restaurantId, input.customerId) : null;
  return store.createSession({
    restaurantId: input.restaurantId,
    branchId: input.branchId,
    conversationId: input.conversationId ?? null,
    customerId: input.customerId,
    language: customer?.preferredLanguage ?? "roman_urdu",
  });
}

export async function runBotTurn(input: BotTurnInput, deps: AgentDeps): Promise<BotTurnResult> {
  const started = Date.now();
  const { store } = deps;
  const nowFn = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const provider = deps.provider ?? activeProvider();
  const text = input.customerMessages.map((m) => m.trim()).filter(Boolean).join("\n");

  const restaurant = await store.getRestaurant(input.restaurantId);
  if (!restaurant) throw new Error("Restaurant not found");

  // --- Session: reuse an open one, expire idle ones, otherwise start fresh.
  let session = input.sessionId ? await store.getSession(input.restaurantId, input.sessionId) : null;
  if (session && OPEN_STATUSES.has(session.status) && nowFn().getTime() - Date.parse(session.lastActivityAt) > BOT_LIMITS.sessionIdleMs) {
    session.status = "abandoned";
    session.stage = "done";
    await store.saveSession(session);
    session = null;
  }
  // Confirm tapped again on an order that was already placed (double tap, slow network): just say so.
  if (session?.status === "completed" && session.orderId && input.buttonId === "confirm") {
    const done = session;
    done.lastActivityAt = nowFn().toISOString();
    await store.saveSession(done);
    return {
      sessionId: done.id,
      replyText: t(done.language).alreadyPlaced,
      showButtons: null,
      orderCreated: null,
      handedOff: false,
      session: done,
      toolCalls: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      estimatedCost: 0,
      latencyMs: Date.now() - started,
      provider,
      model: "",
      error: null,
    };
  }
  if (session && !OPEN_STATUSES.has(session.status)) session = null; // completed/abandoned → new order
  if (!session) {
    session = await startSession(store, {
      restaurantId: input.restaurantId,
      branchId: input.branchId,
      customerId: input.customerId,
      conversationId: input.conversationId,
    });
  }
  const s = session;
  const customer: CustomerInfo | null = s.customerId ? await store.getCustomer(s.restaurantId, s.customerId) : null;

  // --- Language: follow the script/language of this message; remember it.
  // Only what the customer typed decides the language: not button titles, not
  // our own bracketed notes like "[Customer shared a location pin]".
  // Voice transcripts don't count either: Whisper writes Urdu script even when the customer types Roman Urdu.
  const typed = text
    .split("\n")
    .filter((line) => !line.startsWith("[voice note]"))
    .join("\n");
  const detected = input.buttonId ? null : detectLanguage(typed.replace(/\[[^\]]*\]/g, " "));
  if (detected) s.language = detected;
  if (customer && detected && customer.preferredLanguage !== detected) {
    await store.setCustomerLanguage(s.restaurantId, customer.id, detected);
  }
  const at = nowFn().toISOString();
  const history = s.transcript.slice(-BOT_LIMITS.historyMessages);
  s.transcript = [...s.transcript, { role: "customer" as const, text, at }].slice(-MAX_TRANSCRIPT);
  s.lastActivityAt = at;

  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const toolCalls: ToolCallLog[] = [];
  let modelId = deps.model?.modelId ?? "";
  let error: BotTurnResult["error"] = null;

  // The tool context (once created) may hold an updated customer (name saved).
  let ctxRef: BotContext | null = null;
  const finish = async (replyText: string | null, extra: { order?: BotTurnResult["orderCreated"]; handedOff?: boolean; ai?: boolean } = {}) => {
    if (s.status !== "handed_off" && s.status !== "completed" && s.status !== "abandoned") {
      s.stage = computeStage(s, ctxRef?.customer ?? customer);
    }
    if (replyText) s.transcript = [...s.transcript, { role: "bot" as const, text: replyText, at: nowFn().toISOString() }].slice(-MAX_TRANSCRIPT);
    await store.saveSession(s);
    const latencyMs = Date.now() - started;
    const estimatedCost = estimateCost(provider, usage);
    if (extra.ai) {
      await store
        .logTurn({
          restaurantId: s.restaurantId,
          sessionId: s.id,
          inputText: text,
          toolCalls: toolCalls.map((c) => ({ tool: c.tool, input: c.input, output: c.output, ms: c.ms })),
          replyText,
          provider,
          model: modelId,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheReadTokens: usage.cacheRead,
          cacheWriteTokens: usage.cacheWrite,
          estimatedCost,
          latencyMs,
          errorType: error?.type ?? null,
          error: error?.message ?? null,
        })
        .catch((err) => console.error("[bot] could not save ai log", err instanceof Error ? err.message : err));
    }
    return {
      sessionId: s.id,
      replyText,
      showButtons: replyText ? buttonsFor(s, s.language) : null,
      orderCreated: extra.order ?? null,
      handedOff: extra.handedOff ?? s.status === "handed_off",
      session: s,
      toolCalls,
      usage,
      estimatedCost,
      latencyMs,
      provider,
      model: modelId,
      error,
    };
  };

  // --- Rules that never need the AI.
  if (customer?.isBlocked) {
    return finish(t(s.language).blocked(restaurant.phone));
  }
  if (!restaurant.botEnabled || s.status === "handed_off") {
    return finish(null, { handedOff: true }); // staff answer this chat
  }

  const branch = await store.getBranch(s.restaurantId, s.branchId, nowFn());
  if (!branch) throw new Error("Branch not found or inactive");

  let menuIndex: MenuIndex | null = null;
  const ctx: BotContext = {
    store,
    session: s,
    restaurant,
    branch,
    customer,
    now: nowFn,
    menu: async () => (menuIndex ??= buildMenuIndex(await store.getMenu(s.restaurantId, s.branchId))),
    effects: { summary: null, order: null, handedOff: false, cancelled: false },
  };
  ctxRef = ctx;

  // Buttons with one clear meaning are handled by code (fast, no AI, no mistakes).
  if (input.buttonId === "confirm" && s.status === "awaiting_confirmation") {
    const r = await runTool(ctx, "confirm_order", {});
    toolCalls.push({ tool: "confirm_order", input: {}, output: r, ms: 0 });
    if (r.ok && ctx.effects.order) return finish(t(s.language).orderPlaced(ctx.effects.order.orderNumber), { order: ctx.effects.order });
    // Otherwise (cart changed, closed…) let the AI explain and re-summarise.
  }
  if (input.buttonId === "cancel" && !s.orderId) {
    await runTool(ctx, "cancel_session", {});
    return finish(t(s.language).cancelled);
  }
  const direct = BUTTON_TOOLS[input.buttonId ?? ""];
  if (direct) {
    const r = await runTool(ctx, direct.tool, direct.input);
    toolCalls.push({ tool: direct.tool, input: direct.input, output: r, ms: 0 });
  }
  // A location pin is the delivery location (the bot may still ask for a landmark).
  if (input.location) {
    s.orderType = "delivery";
    s.address = {
      ...s.address,
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      text: s.address.text || [input.location.name, input.location.address].filter(Boolean).join(", ") || s.address.text,
    };
    s.summaryHash = null;
    if (s.status === "awaiting_confirmation") s.status = "active";
  }

  // A voice note nobody could understand: no AI. It counts as "not understood"
  // (the third time hands the chat to staff).
  if (input.voiceFailed) {
    await runTool(ctx, "mark_not_understood", {});
    const handed = (s as BotSession).status === "handed_off";
    return finish(handed ? t(s.language).handedOff : t(s.language).voiceUnclear, { handedOff: handed });
  }

  // Nothing to sell (menu not set up, or everything hidden): never let the AI
  // improvise a menu. Say so and pass the chat to staff.
  if ((await ctx.menu()).itemCount === 0) {
    s.status = "handed_off";
    s.handoffReason = "Menu is empty for this branch";
    return finish(t(s.language).menuUnavailable, { handedOff: true });
  }

  // --- The model.
  let model: { model: LanguageModel; modelId: string };
  try {
    model = deps.model ?? getModel(provider);
  } catch (err) {
    error = { type: "error", message: err instanceof Error ? err.message : String(err) };
    s.status = "handed_off";
    s.handoffReason = "AI is not configured";
    return finish(t(s.language).fallback, { handedOff: true, ai: true });
  }
  modelId = model.modelId;

  const idx = await ctx.menu();
  const instructions: SystemModelMessage[] = [
    {
      role: "system",
      content: staticPrompt(restaurant, idx),
      ...(SUPPORTS_CACHE_CONTROL[provider] ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } } : {}),
    },
    { role: "system", content: dynamicPrompt({ session: s, branch, customer }) },
  ];
  const messages: ModelMessage[] = [
    ...history.map((e): ModelMessage => (e.role === "customer" ? { role: "user", content: e.text } : { role: "assistant", content: e.text })),
    { role: "user", content: text },
  ];

  // Tools change the session in memory: keep a copy so a retry starts clean.
  const snapshot = structuredClone(s);
  const customerSnapshot = ctx.customer;
  const attempt = async () => {
    const log: ToolCallLog[] = [];
    try {
      const result = await generateText({
        model: model.model,
        instructions,
        messages,
        tools: createAiTools(ctx, log),
        stopWhen: isStepCount(BOT_LIMITS.maxToolIterations),
        maxRetries: 0,
        temperature: 0.2,
        abortSignal: AbortSignal.timeout(BOT_LIMITS.requestTimeoutMs),
        providerOptions: provider === "google" ? { google: { thinkingConfig: { thinkingLevel: "low" } } } : undefined,
      });
      toolCalls.push(...log);
      return result;
    } catch (err) {
      toolCalls.push(...log);
      throw err;
    }
  };

  let result: Awaited<ReturnType<typeof attempt>> | null = null;
  for (let tryNo = 0; tryNo < 2 && !result; tryNo++) {
    try {
      result = await attempt();
    } catch (err) {
      const rateLimited = isRateLimitError(err);
      error = {
        type: rateLimited ? "rate_limit" : isTimeoutError(err) ? "timeout" : "error",
        message: (err instanceof Error ? err.message : String(err)).slice(0, 1000),
      };
      // Undo half-done tool work before retrying or giving up.
      Object.assign(s, structuredClone(snapshot));
      ctx.customer = customerSnapshot;
      ctx.effects = { summary: null, order: null, handedOff: false, cancelled: false };
      if ((rateLimited || isOverloadedError(err)) && tryNo === 0) {
        console.warn(`[bot] ${rateLimited ? "rate limited" : "provider busy"}, retrying once`, error.message.slice(0, 200));
        await sleep(BOT_LIMITS.rateLimitRetryMs);
        continue;
      }
      break;
    }
  }

  if (!result) {
    console.error(`[bot] AI ${error?.type ?? "error"}`, error?.message.slice(0, 300));
    s.status = "handed_off";
    s.handoffReason = `AI ${error?.type ?? "error"}`;
    return finish(t(s.language).fallback, { handedOff: true, ai: true });
  }
  error = null; // a retry succeeded

  const u = result.totalUsage;
  usage.input = u.inputTokens ?? 0;
  usage.output = u.outputTokens ?? 0;
  usage.cacheRead = u.inputTokenDetails?.cacheReadTokens ?? 0;
  usage.cacheWrite = u.inputTokenDetails?.cacheWriteTokens ?? 0;

  // --- The reply. Code writes it where accuracy matters.
  // (Tools may have changed the status during the turn: read it fresh.)
  const status = (): BotSession["status"] => s.status;
  const tx = t(s.language);
  let reply: string;
  if (ctx.effects.order) reply = tx.orderPlaced(ctx.effects.order.orderNumber);
  else if (ctx.effects.cancelled) reply = tx.cancelled;
  else if (ctx.effects.summary && s.summaryHash && s.status === "awaiting_confirmation") reply = ctx.effects.summary.text;
  else if (ctx.effects.handedOff || status() === "handed_off") reply = tx.handedOff;
  else {
    reply = scrubRefs(result.text.trim(), idx, s.cart).trim() || tx.notUnderstood;
  }
  return finish(reply, { order: ctx.effects.order, handedOff: status() === "handed_off", ai: true });
}
