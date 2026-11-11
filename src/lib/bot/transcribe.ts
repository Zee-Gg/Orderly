import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { generateText, transcribe } from "ai";
import { isOverloadedError, isRateLimitError } from "./agent";
import { TRANSCRIBE_COST_PER_MINUTE, TRANSCRIBE_LIMITS, TRANSCRIBE_MODELS, TRANSCRIBE_PROVIDERS, type TranscribeProvider } from "./config";
import { MIN_VOICE_SECONDS, type NormalizedAudio } from "./voice/audio";

/**
 * Voice note → text. Provider from TRANSCRIBE_PROVIDER (default groq):
 *  - groq:   Whisper, language forced to Urdu ("ur") → Urdu script or Roman
 *            Urdu, never Hindi/Devanagari.
 *  - google: Gemini with the audio as input, told to transcribe word for word.
 *            Its OWN key: GOOGLE_TRANSCRIBE_API_KEY, else the chat key
 *            (GOOGLE_GENERATIVE_AI_API_KEY).
 * No Groq key → google (logged). A missing key never crashes: it fails gracefully.
 * Keys are read here only (server code). No Next.js imports.
 */

type Env = Record<string, string | undefined>;
/** Which key a transcription used — shown in the playground (never the key itself). */
export type KeySource = "groq" | "voice" | "chat" | "fake";

export type TranscribeOk = {
  ok: true;
  text: string;
  /** Silence, noise, filler words or too short: don't pass it to the bot. */
  unclear: boolean;
  provider: TranscribeProvider;
  model: string;
  keySource: KeySource;
  latencyMs: number;
  estimatedCost: number;
  /** Set when the requested provider couldn't be used. */
  note: string | null;
};
export type TranscribeFail = {
  ok: false;
  error: string;
  errorType: "rate_limit" | "timeout" | "error";
  provider: TranscribeProvider;
  model: string;
  keySource: KeySource;
  latencyMs: number;
  note: string | null;
};
export type TranscribeResult = TranscribeOk | TranscribeFail;

/** One provider call: audio in, raw text out (injectable for tests). */
export type TranscribeEngine = (audio: NormalizedAudio, ctx: { apiKey: string; model: string; signal: AbortSignal }) => Promise<string>;

const GOOGLE_PROMPT = `Transcribe this voice note exactly as spoken, word for word.
- The speaker is usually Pakistani, ordering food: Urdu, Roman Urdu, English, or a mix.
- Write Urdu words in Urdu script or Roman Urdu exactly as spoken; English words in English. Never Hindi/Devanagari.
- Do NOT translate, rephrase, correct, summarise or add anything. Keep numbers as spoken.
- If there is no clear speech (silence, noise, music), output exactly: [unclear]
Output only the transcript.`;

const ENGINES: Record<TranscribeProvider, TranscribeEngine> = {
  async groq(audio, { apiKey, model, signal }) {
    const r = await transcribe({
      model: createGroq({ apiKey }).transcription(model),
      audio: audio.bytes,
      providerOptions: { groq: { language: "ur", temperature: 0 } },
      maxRetries: 0,
      abortSignal: signal,
    });
    return r.text;
  },
  async google(audio, { apiKey, model, signal }) {
    // A separate provider instance with the VOICE key (chat uses its own).
    const r = await generateText({
      model: createGoogle({ apiKey })(model),
      maxRetries: 0,
      temperature: 0,
      abortSignal: signal,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: GOOGLE_PROMPT },
            { type: "file", data: audio.bytes, mediaType: audio.mediaType },
          ],
        },
      ],
    });
    return r.text;
  },
};

/** TEST ONLY (BOT_FAKE_AI=1): a fixed transcript, no provider called. */
const fakeEngine: TranscribeEngine = async () => process.env.BOT_FAKE_TRANSCRIPT || "2 zinger burger aur ek coke";

/** Providers that have a key right now (the playground and voice tests only offer these). */
export function availableTranscribeProviders(env: Env = process.env): TranscribeProvider[] {
  return TRANSCRIBE_PROVIDERS.filter((p) =>
    p === "groq" ? !!env.GROQ_API_KEY?.trim() : !!(env.GOOGLE_TRANSCRIBE_API_KEY?.trim() || env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()),
  );
}

export function resolveTranscriber(
  requested: string | null | undefined,
  env: Env = process.env,
): { provider: TranscribeProvider; model: string; apiKey: string | null; keySource: KeySource; note: string | null } {
  const wanted: TranscribeProvider = requested === "google" || requested === "groq" ? requested : env.TRANSCRIBE_PROVIDER === "google" ? "google" : "groq";
  let provider = wanted;
  let note: string | null = null;
  if (provider === "groq" && !env.GROQ_API_KEY?.trim()) {
    provider = "google";
    note = "GROQ_API_KEY is not set: using Google for voice notes";
  }
  const model = env[`TRANSCRIBE_MODEL_${provider.toUpperCase()}`]?.trim() || TRANSCRIBE_MODELS[provider];
  if (env.BOT_FAKE_AI === "1") return { provider, model: "fake-transcribe", apiKey: "fake", keySource: "fake", note };
  if (provider === "groq") return { provider, model, apiKey: env.GROQ_API_KEY!.trim(), keySource: "groq", note };
  const voiceKey = env.GOOGLE_TRANSCRIBE_API_KEY?.trim();
  const chatKey = env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  return { provider, model, apiKey: voiceKey || chatKey || null, keySource: voiceKey ? "voice" : "chat", note };
}

const FILLERS = new Set(
  "um umm uh uhh uhm hmm hm mm mmm ah aa aah aaa oh ooh er erm eh huh hain han haan ji acha ok okay hello hi ہمم ہم ام آ آں اں اوہ جی ہاں ہیلو اچھا".split(" "),
);
// What Whisper typically "hears" in silence or noise.
const SILENCE_HALLUCINATIONS =
  /^(thank you( for watching)?|thanks for watching|please subscribe|subtitles?( by .*)?|bye|you|music|شکریہ|بہت شکریہ|ترجمہ.*|سبسکرائب.*|♪+|\[.*]|\(.*\))$/i;

/** Empty, only filler words, or a known silence hallucination → unclear. */
export function isUnclearTranscript(text: string): boolean {
  const clean = text
    .toLowerCase()
    .replace(/[.,!?؟۔،;:"'…\-–—*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || clean === "[unclear]" || clean === "unclear") return true;
  if (SILENCE_HALLUCINATIONS.test(clean)) return true;
  const words = clean.split(" ");
  if (words.every((w) => FILLERS.has(w))) return true;
  // The same word over and over (a common noise artefact).
  if (words.length >= 4 && new Set(words).size === 1) return true;
  return false;
}

export async function transcribeVoice(
  audio: NormalizedAudio,
  opts: {
    provider?: string | null;
    durationSec?: number | null;
    env?: Env;
    engines?: Partial<Record<TranscribeProvider, TranscribeEngine>>;
    sleep?: (ms: number) => Promise<void>;
    log?: (line: string) => void;
  } = {},
): Promise<TranscribeResult> {
  const env = opts.env ?? process.env;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const r = resolveTranscriber(opts.provider, env);
  if (r.note) (opts.log ?? console.warn)(`[voice] ${r.note}`);
  const started = Date.now();
  const base = { provider: r.provider, model: r.model, keySource: r.keySource, note: r.note };

  // Too short to hold an order: never send it to a provider (it would invent words).
  if (opts.durationSec != null && opts.durationSec < MIN_VOICE_SECONDS) {
    return { ok: true, text: "", unclear: true, latencyMs: 0, estimatedCost: 0, ...base };
  }
  if (!r.apiKey) {
    return { ok: false, error: "No API key for voice transcription", errorType: "error", latencyMs: 0, ...base };
  }
  const engine = env.BOT_FAKE_AI === "1" ? fakeEngine : (opts.engines?.[r.provider] ?? ENGINES[r.provider]);

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = (await engine(audio, { apiKey: r.apiKey, model: r.model, signal: AbortSignal.timeout(TRANSCRIBE_LIMITS.timeoutMs) })).trim();
      const minutes = (opts.durationSec ?? 0) / 60;
      return {
        ok: true,
        text,
        unclear: isUnclearTranscript(text),
        latencyMs: Date.now() - started,
        estimatedCost: Math.round(minutes * TRANSCRIBE_COST_PER_MINUTE[r.provider] * 1_000_000) / 1_000_000,
        ...base,
      };
    } catch (err) {
      lastError = err;
      if (attempt === 0 && (isRateLimitError(err) || isOverloadedError(err))) {
        await sleep(TRANSCRIBE_LIMITS.rateLimitRetryMs);
        continue;
      }
      break;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  const timeout = lastError instanceof Error && (lastError.name === "TimeoutError" || lastError.name === "AbortError");
  return {
    ok: false,
    error: message.slice(0, 500),
    errorType: isRateLimitError(lastError) ? "rate_limit" : timeout ? "timeout" : "error",
    latencyMs: Date.now() - started,
    ...base,
  };
}
