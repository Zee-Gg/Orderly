import type { BotButton, BotTurnResult } from "./agent";
import type { BotSession } from "./types";

/**
 * Shared by the playground's server action (text) and its voice route, so a
 * text turn and a voice turn look exactly the same in the browser.
 */

/** Dev-only tools (playground, voice tests). E2E sets ENABLE_DEV_TOOLS=1 on the
 *  production test build; never set it in real production. */
export function devToolsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" || env.ENABLE_DEV_TOOLS === "1";
}

export type PlaygroundSession = Pick<
  BotSession,
  "id" | "status" | "stage" | "cart" | "orderType" | "address" | "paymentMethod" | "language" | "failedAttempts" | "orderId" | "handoffReason"
>;

export type PlaygroundTurn = {
  replyText: string | null;
  showButtons: BotButton[] | null;
  orderCreated: { id: string; orderNumber: number } | null;
  handedOff: boolean;
  session: PlaygroundSession;
  toolCalls: { tool: string; input: unknown; output: unknown; ms: number }[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  estimatedCost: number;
  latencyMs: number;
  provider: string;
  model: string;
  error: { type: string; message: string } | null;
};

/** What the playground shows about a voice note (never an API key). */
export type PlaygroundVoice = {
  kind: "ok" | "too_long" | "unclear";
  transcript: string | null;
  provider: string | null;
  model: string | null;
  /** Which key: groq, the Google VOICE key, or the Google CHAT key (fallback). */
  keySource: string | null;
  transcribeMs: number | null;
  durationSec: number | null;
  converted: boolean;
  note: string | null;
  reason: string | null;
};

export function viewSession(s: BotSession): PlaygroundSession {
  return {
    id: s.id,
    status: s.status,
    stage: s.stage,
    cart: s.cart,
    orderType: s.orderType,
    address: s.address,
    paymentMethod: s.paymentMethod,
    language: s.language,
    failedAttempts: s.failedAttempts,
    orderId: s.orderId,
    handoffReason: s.handoffReason,
  };
}

export function toPlaygroundTurn(r: BotTurnResult): PlaygroundTurn {
  return {
    replyText: r.replyText,
    showButtons: r.showButtons,
    orderCreated: r.orderCreated,
    handedOff: r.handedOff,
    session: viewSession(r.session),
    toolCalls: r.toolCalls.map((c) => ({ tool: c.tool, input: c.input, output: c.output, ms: c.ms })),
    usage: r.usage,
    estimatedCost: r.estimatedCost,
    latencyMs: r.latencyMs,
    provider: r.provider,
    model: r.model,
    error: r.error,
  };
}
