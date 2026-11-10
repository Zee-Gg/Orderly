import { z } from "zod";

/**
 * AI order bot settings. Switch provider with AI_PROVIDER=google|anthropic|groq
 * (only that provider's API key is needed). No Next.js imports.
 */
export const AI_PROVIDERS = ["google", "anthropic", "groq"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Model per provider. Override with BOT_MODEL_<PROVIDER> (e.g. BOT_MODEL_GOOGLE). */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  // Fast Flash-family model. On 2026-11-09 the full Flash models (gemini-3.8-flash,
  // 3.6, 3.5) timed out / returned "high demand" on the free tier; Flash-Lite
  // answered in ~2s and scored 97%+ on the eval. Switch with BOT_MODEL_GOOGLE=gemini-3.8-flash.
  google: "gemini-3.5-flash-lite",
  anthropic: "claude-haiku-5-5",
  groq: "llama-3.3-70b-versatile",
};

/** Env var that holds each provider's key (server-only, never NEXT_PUBLIC_). */
export const API_KEY_ENV: Record<AiProvider, string> = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
};

/**
 * USD per 1 million tokens. PLACEHOLDERS: fill in from each provider's
 * pricing page. Free tier = 0.
 */
export const COST_PER_MTOK: Record<AiProvider, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  google: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  anthropic: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  groq: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/** Providers where we add explicit prompt-cache markers (others cache implicitly or not at all). */
export const SUPPORTS_CACHE_CONTROL: Record<AiProvider, boolean> = { google: false, anthropic: true, groq: false };

export const BOT_LIMITS = {
  /** Model ↔ tool round trips per customer turn. */
  maxToolIterations: 6,
  /** Whole turn (all steps) must finish in this time. */
  requestTimeoutMs: 45_000,
  /** One retry after a rate-limit error, after this wait. */
  rateLimitRetryMs: 3_000,
  /** Messages of history sent to the model. */
  historyMessages: 20,
  /** No activity for this long → session abandoned, next message starts fresh. */
  sessionIdleMs: 2 * 60 * 60 * 1000,
  /** Failed understanding attempts before handing off to staff. */
  maxFailedAttempts: 3,
  /** Bigger menus are not put in the prompt (the bot uses search_menu). */
  maxMenuItemsInPrompt: 150,
} as const;

export function activeProvider(env: Record<string, string | undefined> = process.env): AiProvider {
  const parsed = z.enum(AI_PROVIDERS).safeParse((env.AI_PROVIDER ?? "google").trim().toLowerCase());
  return parsed.success ? parsed.data : "google";
}

export function modelFor(provider: AiProvider, env: Record<string, string | undefined> = process.env): string {
  return env[`BOT_MODEL_${provider.toUpperCase()}`]?.trim() || DEFAULT_MODELS[provider];
}

export function estimateCost(
  provider: AiProvider,
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number },
): number {
  const r = COST_PER_MTOK[provider];
  // `input` includes cached tokens on most providers: bill only the uncached part at the input rate.
  const uncached = Math.max(0, usage.input - usage.cacheRead - usage.cacheWrite);
  const usd = (uncached * r.input + usage.output * r.output + usage.cacheRead * r.cacheRead + usage.cacheWrite * r.cacheWrite) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
