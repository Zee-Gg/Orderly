import { readFileSync } from "node:fs";
import { APICallError } from "ai";
import { describe, expect, it, vi } from "vitest";
import { availableTranscribeProviders, isUnclearTranscript, resolveTranscriber, transcribeVoice } from "../transcribe";
import { audioDurationSeconds, detectAudioFormat, normalizeAudio } from "./audio";
import { handleVoice } from "./handle";
import { opusPacketSamples } from "./webm-to-ogg";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/voice-eval/fixtures/${name}`));

/** A silent 8 kHz / 8-bit mono WAV of the given length. */
function silentWav(seconds: number): Uint8Array {
  const rate = 8000;
  const samples = Math.round(seconds * rate);
  const buf = new Uint8Array(44 + samples);
  const v = new DataView(buf.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => (buf[at + i] = c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  ascii(36, "data");
  v.setUint32(40, samples, true);
  buf.fill(128, 44);
  return buf;
}

const ENV = { GROQ_API_KEY: "gsk", GOOGLE_TRANSCRIBE_API_KEY: "voice-key", GOOGLE_GENERATIVE_AI_API_KEY: "chat-key", TRANSCRIBE_PROVIDER: "groq" };

describe("audio formats (WhatsApp OGG and browser recordings)", () => {
  it("detects formats by their bytes", () => {
    expect(detectAudioFormat(fixture("order-en.ogg"))).toBe("ogg");
    expect(detectAudioFormat(fixture("order-en.webm"))).toBe("webm");
    expect(detectAudioFormat(fixture("order-en.wav"))).toBe("wav");
    expect(detectAudioFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBe("unknown");
  });

  it("WhatsApp OGG passes through; a Chrome WebM recording becomes OGG/Opus with the right length", async () => {
    const ogg = normalizeAudio(fixture("order-en.ogg"));
    expect(ogg).toMatchObject({ format: "ogg", mediaType: "audio/ogg", converted: false });
    const fromWebm = normalizeAudio(fixture("order-en.webm"));
    expect(fromWebm).toMatchObject({ format: "ogg", mediaType: "audio/ogg", converted: true });
    expect(detectAudioFormat(fromWebm.bytes)).toBe("ogg");
    expect(await audioDurationSeconds(fromWebm)).toBeCloseTo(3.96, 1);
    expect(await audioDurationSeconds(normalizeAudio(fixture("order-en.wav")))).toBeCloseTo(3.34, 1);
  });

  it("reads Opus frame sizes from the TOC byte", () => {
    expect(opusPacketSamples(new Uint8Array([0xfc, 0]))).toBe(960); // CELT 20 ms, 1 frame
    expect(opusPacketSamples(new Uint8Array([0x08]))).toBe(960); // SILK 20 ms
    expect(opusPacketSamples(new Uint8Array([0xfd]))).toBe(1920); // 2 frames
  });

  it("rejects things that aren't audio", () => {
    expect(() => normalizeAudio(new TextEncoder().encode("hello, not audio at all"))).toThrow(/Unsupported/);
  });
});

describe("unclear audio", () => {
  it("flags empty, filler-only, repeated and typical silence hallucinations", () => {
    for (const t of ["", "   ", "[unclear]", "um", "Hmm... uh", "ہمم", "Thank you.", "Thanks for watching!", "شکریہ", "♪♪", "ji ji ji ji"]) {
      expect(isUnclearTranscript(t), JSON.stringify(t)).toBe(true);
    }
    for (const t of ["2 zinger burger aur ek coke", "دو زنگر برگر اور ایک کوک", "ek biryani please"]) {
      expect(isUnclearTranscript(t), t).toBe(false);
    }
  });

  it("under a second → unclear without calling any provider", async () => {
    const engine = vi.fn(async () => "two zinger burgers");
    const r = await handleVoice(silentWav(0.5), { restaurantId: "r", env: ENV, engines: { groq: engine } });
    expect(r).toMatchObject({ kind: "unclear" });
    expect(engine).not.toHaveBeenCalled();
  });

  it("silence that the provider turns into 'Thank you' → unclear (never passed to the bot)", async () => {
    const r = await handleVoice(silentWav(3), { restaurantId: "r", env: ENV, engines: { groq: async () => "Thank you." } });
    expect(r).toMatchObject({ kind: "unclear", reason: "No clear speech" });
  });
});

describe("duration limit", () => {
  it("over 2 minutes → too_long, nothing transcribed", async () => {
    const engine = vi.fn(async () => "x");
    const r = await handleVoice(silentWav(121), { restaurantId: "r", env: ENV, engines: { groq: engine } });
    expect(r).toMatchObject({ kind: "too_long" });
    expect(engine).not.toHaveBeenCalled();
  });

  it("a normal voice note is transcribed and logged as a transcription", async () => {
    const logTurn = vi.fn(async () => {});
    const r = await handleVoice(fixture("order-en.ogg"), {
      restaurantId: "r",
      sessionId: "s",
      env: ENV,
      engines: { groq: async () => "دو زنگر برگر اور ایک کوک" },
      logTurn,
    });
    expect(r).toMatchObject({ kind: "ok", transcript: "دو زنگر برگر اور ایک کوک" });
    expect(logTurn).toHaveBeenCalledWith(
      expect.objectContaining({ type: "transcription", provider: "groq", model: "whisper-large-v3", replyText: "دو زنگر برگر اور ایک کوک", sessionId: "s" }),
    );
  });
});

describe("provider and key selection", () => {
  it("google uses the voice key, else falls back to the chat key", () => {
    expect(resolveTranscriber("google", ENV)).toMatchObject({ provider: "google", apiKey: "voice-key", keySource: "voice" });
    expect(resolveTranscriber("google", { GOOGLE_GENERATIVE_AI_API_KEY: "chat-key" })).toMatchObject({ apiKey: "chat-key", keySource: "chat" });
  });

  it("groq is the default; without GROQ_API_KEY it falls back to google with a note", () => {
    expect(resolveTranscriber(null, ENV)).toMatchObject({ provider: "groq", model: "whisper-large-v3", keySource: "groq", note: null });
    const noGroq = { GOOGLE_GENERATIVE_AI_API_KEY: "chat-key" };
    expect(resolveTranscriber("groq", noGroq)).toMatchObject({ provider: "google", note: expect.stringContaining("GROQ_API_KEY") });
    expect(availableTranscribeProviders(noGroq)).toEqual(["google"]);
    expect(availableTranscribeProviders(ENV)).toEqual(["groq", "google"]);
  });

  it("no key at all → a graceful failure, never a crash", async () => {
    const r = await transcribeVoice(normalizeAudio(fixture("order-en.ogg")), { durationSec: 4, env: {}, log: () => {} });
    expect(r).toMatchObject({ ok: false, error: "No API key for voice transcription" });
  });

  it("one retry on a rate limit, then the answer", async () => {
    let calls = 0;
    const engine = vi.fn(async () => {
      if (calls++ === 0) throw new APICallError({ message: "rate limited", url: "x", requestBodyValues: {}, statusCode: 429 });
      return "ek biryani";
    });
    const r = await transcribeVoice(normalizeAudio(fixture("order-en.ogg")), { durationSec: 4, env: ENV, engines: { groq: engine }, sleep: async () => {} });
    expect(r).toMatchObject({ ok: true, text: "ek biryani" });
    expect(engine).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry", async () => {
    const engine = vi.fn(async () => {
      throw new APICallError({ message: "rate limited", url: "x", requestBodyValues: {}, statusCode: 429 });
    });
    const r = await transcribeVoice(normalizeAudio(fixture("order-en.ogg")), { durationSec: 4, env: ENV, engines: { groq: engine }, sleep: async () => {} });
    expect(r).toMatchObject({ ok: false, errorType: "rate_limit" });
    expect(engine).toHaveBeenCalledTimes(2);
  });
});

describe("voice eval word match (fair to Urdu script and Roman Urdu)", async () => {
  const { matchScore, scriptOf, transliterateUrdu } = await import("./eval");
  it("Urdu script, Roman Urdu, English number words and digits all match", () => {
    expect(matchScore("do zinger burger aur ek coke", "دو زنگر برگر اور ایک کوک").score).toBeGreaterThanOrEqual(0.8);
    expect(matchScore("two zinger burgers and one coke", "2 Zinger burgers and 1 Coke").score).toBe(1);
    expect(matchScore("do zinger burger", "2 zinger burger").score).toBe(1);
    // English speech, Urdu-script transcript (Whisper with language "ur"): same words, other script.
    expect(matchScore("Two zinger burgers and one coke please", "دو زنگر برگرز اور ایک کوک پلیز").score).toBeGreaterThanOrEqual(0.8);
  });
  it("ignores punctuation and case, and catches missing words", () => {
    expect(matchScore("Ek biryani, please!", "ek biryani please").score).toBe(1);
    expect(matchScore("teen naan aur do raita", "teen naan").score).toBeLessThan(0.5);
    expect(matchScore("ek biryani", "").score).toBe(0);
  });
  it("notes the script and transliterates Urdu letters", () => {
    expect(scriptOf("دو زنگر")).toBe("urdu");
    expect(scriptOf("2 zinger")).toBe("latin");
    expect(scriptOf("2 زنگر")).toBe("urdu"); // digits are neutral
    expect(scriptOf("zinger زنگر")).toBe("mixed");
    expect(transliterateUrdu("زنگر")).toBe("zngr");
  });
});
