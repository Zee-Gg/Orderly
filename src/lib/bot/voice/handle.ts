import { transcribeVoice, type TranscribeEngine, type TranscribeResult } from "../transcribe";
import type { AiLogRow } from "../types";
import { audioDurationSeconds, MAX_VOICE_SECONDS, normalizeAudio } from "./audio";

/**
 * ONE voice-note path for WhatsApp and the playground:
 * format → duration check (max 2 min) → transcription → "unclear" check → log.
 * No Next.js imports.
 */
export type VoiceOutcome =
  | { kind: "ok"; transcript: string; durationSec: number | null; result: TranscribeResult & { ok: true }; converted: boolean }
  | { kind: "too_long"; durationSec: number }
  | { kind: "unclear"; durationSec: number | null; result: TranscribeResult | null; reason: string };

/** Marks voice text for the bot (and is stripped before language detection). */
export const VOICE_MARKER = "[voice note]";

export async function handleVoice(
  bytes: Uint8Array,
  opts: {
    restaurantId: string;
    sessionId?: string | null;
    provider?: string | null;
    logTurn?: (row: AiLogRow) => Promise<void>;
    engines?: Partial<Record<"groq" | "google", TranscribeEngine>>;
    env?: Record<string, string | undefined>;
  },
): Promise<VoiceOutcome> {
  let audio;
  try {
    audio = normalizeAudio(bytes);
  } catch (err) {
    return { kind: "unclear", durationSec: null, result: null, reason: err instanceof Error ? err.message : "Unreadable audio" };
  }
  const durationSec = await audioDurationSeconds(audio);
  if (durationSec !== null && durationSec > MAX_VOICE_SECONDS) return { kind: "too_long", durationSec };

  const result = await transcribeVoice(audio, { provider: opts.provider, durationSec, env: opts.env, engines: opts.engines });
  await opts
    .logTurn?.({
      type: "transcription",
      restaurantId: opts.restaurantId,
      sessionId: opts.sessionId ?? null,
      inputText: `[voice note${durationSec != null ? ` ${durationSec.toFixed(1)}s` : ""}, ${audio.format}${audio.converted ? " (converted from webm)" : ""}]`,
      toolCalls: [],
      replyText: result.ok ? result.text || "(empty)" : null,
      provider: result.provider,
      model: result.model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCost: result.ok ? result.estimatedCost : 0,
      latencyMs: result.latencyMs,
      errorType: result.ok ? null : result.errorType,
      error: result.ok ? (result.unclear ? "unclear audio" : null) : result.error,
    })
    .catch((err) => console.error("[voice] could not log transcription", err instanceof Error ? err.message : err));

  if (!result.ok) return { kind: "unclear", durationSec, result, reason: result.error };
  if (result.unclear) return { kind: "unclear", durationSec, result, reason: "No clear speech" };
  return { kind: "ok", transcript: result.text, durationSec, result, converted: audio.converted };
}
