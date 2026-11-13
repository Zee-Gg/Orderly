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
 * USD per 1 million tokens.
 * >>> TODO BEFORE LAUNCH: FILL IN from your provider's PAID pricing page. <<<
 * These are 0 (= free tier), so /admin/ai-usage shows $0 and the monthly AI
 * budget never triggers until you fill them in.
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

// ---------------------------------------------------------------------------
// Voice notes (Phase 7B)
// ---------------------------------------------------------------------------

export const TRANSCRIBE_PROVIDERS = ["groq", "google"] as const;
export type TranscribeProvider = (typeof TRANSCRIBE_PROVIDERS)[number];

/** Override with TRANSCRIBE_MODEL_GROQ / TRANSCRIBE_MODEL_GOOGLE. */
export const TRANSCRIBE_MODELS: Record<TranscribeProvider, string> = {
  // large-v3 (not turbo): in testing it kept Urdu script with language "ur";
  // turbo sometimes switched to English words and digits.
  groq: "whisper-large-v3",
  // Gemini with audio input (generateText + audio file part), told to transcribe word for word.
  google: "gemini-3.5-flash-lite",
};

/** USD per audio minute. >>> TODO BEFORE LAUNCH: FILL IN from the PAID pricing page (0 = free tier). <<< */
export const TRANSCRIBE_COST_PER_MINUTE: Record<TranscribeProvider, number> = { groq: 0, google: 0 };

export const TRANSCRIBE_LIMITS = {
  timeoutMs: 30_000,
  rateLimitRetryMs: 2_000,
} as const;

/**
 * Production must run on a PAID AI key: the free tier rate-limits a busy
 * restaurant within minutes. Set AI_PROVIDER_TIER=paid once the key is on a
 * paid plan. Returns the warning shown on /admin/health, or null.
 */
export function aiTierWarning(env: Record<string, string | undefined> = process.env): string | null {
  const production = env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview";
  const paid = env.AI_PROVIDER_TIER === "paid";
  const ratesMissing = Object.values(COST_PER_MTOK[activeProvider(env)]).every((n) => n === 0);
  if (production && !paid) {
    return `The AI provider (${activeProvider(env)}) is not marked as paid. Free tiers rate-limit real restaurants — use a paid key and set AI_PROVIDER_TIER=paid.`;
  }
  if (production && ratesMissing) {
    return "AI cost rates are 0 in src/lib/bot/config.ts — fill them in so AI costs and budgets are correct.";
  }
  return null;
}
