import { wordScore } from "../search";
import { availableTranscribeProviders, transcribeVoice } from "../transcribe";
import type { TranscribeProvider } from "../config";
import { audioDurationSeconds, normalizeAudio } from "./audio";

/**
 * Voice eval: transcribe every recorded test with a provider and score it
 * against what was really said. Fair to Urdu script AND Roman Urdu: both
 * sides are transliterated to rough Roman letters and compared word by word
 * with fuzzy matching (so "زنگر" = "zinger", "دو" = "do" = "2").
 * No Next.js imports (used by /dev/voice-tests and `npm run eval:voice`).
 */
import { VOICE_TAGS, type VoiceCase } from "./eval-types";

export { VOICE_TAGS, type VoiceCase, type VoiceTag } from "./eval-types";

// --- fair text comparison ------------------------------------------------------

const URDU_TO_ROMAN: Record<string, string> = {
  ا: "a", آ: "a", أ: "a", ب: "b", پ: "p", ت: "t", ٹ: "t", ث: "s", ج: "j", چ: "ch", ح: "h", خ: "kh", د: "d", ڈ: "d",
  ذ: "z", ر: "r", ڑ: "r", ز: "z", ژ: "zh", س: "s", ش: "sh", ص: "s", ض: "z", ط: "t", ظ: "z", ع: "a", غ: "gh",
  ف: "f", ق: "q", ک: "k", ك: "k", گ: "g", ل: "l", م: "m", ن: "n", ں: "n", و: "o", ہ: "h", ۂ: "h", ة: "h", ھ: "h",
  ء: "", ی: "i", ي: "i", ے: "e", ۓ: "e", ئ: "i", ؤ: "o",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

const NUMBER_WORDS: Record<string, string> = {
  ek: "1", aik: "1", ik: "1", one: "1", a: "1", an: "1",
  do: "2", doo: "2", two: "2",
  teen: "3", tin: "3", three: "3",
  char: "4", chaar: "4", chr: "4", four: "4",
  panch: "5", paanch: "5", five: "5",
};

export function transliterateUrdu(text: string): string {
  return [...text.normalize("NFC")].map((c) => URDU_TO_ROMAN[c] ?? c).join("");
}

export function scriptOf(text: string): "urdu" | "latin" | "mixed" | "none" {
  const urdu = /[؀-ۿ]/.test(text);
  const latin = /[a-z]/i.test(text);
  return urdu && latin ? "mixed" : urdu ? "urdu" : latin ? "latin" : "none";
}

export function evalTokens(text: string): string[] {
  return transliterateUrdu(text.toLowerCase())
    .replace(/[ً-ٰٟ]/g, "") // Urdu diacritics
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUMBER_WORDS[w] ?? w);
}

/**
 * Sound-alike key: what a word sounds like in either script once transliterated.
 * c/q/k → k, z/s → s, ph → f, w → v, vowels and h dropped: "burgers" = "برگرز"
 * (brgrs), "coke" = "کوک" (kk), "please" = "پلیز" (pls).
 */
export function phoneticKey(word: string): string {
  return word
    .replace(/ph/g, "f")
    .replace(/ch/g, "C")
    .replace(/sh/g, "S")
    .replace(/kh/g, "K")
    .replace(/gh/g, "G")
    .replace(/[cq]/g, "k")
    .replace(/[zx]/g, "s")
    .replace(/w/g, "v")
    .replace(/[aeiouyh]/g, "")
    .replace(/(.)+/g, "$1");
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Same word, possibly in the other script: spelling-level OR sound-level match. */
function sameWord(w: string, g: string): number {
  const spelled = wordScore(w, g);
  const kw = phoneticKey(w);
  const kg = phoneticKey(g);
  if (!kw || !kg) return spelled;
  const sound = kw === kg ? 0.95 : Math.max(kw.length, kg.length) >= 4 && editDistance(kw, kg) <= 1 ? 0.8 : 0;
  return Math.max(spelled, sound);
}

/** Share of the expected words found in the transcript (0..1), fuzzy, each word used once. */
export function matchScore(expected: string, transcript: string): { score: number; matched: number; total: number } {
  const want = evalTokens(expected);
  const got = evalTokens(transcript);
  if (!want.length) return { score: got.length ? 0 : 1, matched: 0, total: 0 };
  const used = new Set<number>();
  let matched = 0;
  for (const w of want) {
    let best = -1;
    let bestScore = 0;
    got.forEach((g, i) => {
      if (used.has(i)) return;
      const s = /^\d+$/.test(w) || /^\d+$/.test(g) ? (w === g ? 1 : 0) : sameWord(w, g);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    if (best >= 0 && bestScore >= 0.7) {
      used.add(best);
      matched++;
    }
  }
  return { score: Math.round((matched / want.length) * 1000) / 1000, matched, total: want.length };
}

// --- running -------------------------------------------------------------------

import type { CartCheck, VoiceCaseResult, VoiceEvalReport } from "./eval-types";
export type { CartCheck, VoiceCaseResult, VoiceEvalReport } from "./eval-types";

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : 0);

export async function runVoiceEval(opts: {
  cases: VoiceCase[];
  readAudio: (file: string) => Uint8Array;
  provider: "groq" | "google" | "both";
  checkCart?: CartCheck;
  env?: Record<string, string | undefined>;
  onProgress?: (line: string) => void;
}): Promise<VoiceEvalReport> {
  const env = opts.env ?? process.env;
  const available = availableTranscribeProviders(env);
  const wanted: TranscribeProvider[] = opts.provider === "both" ? ["groq", "google"] : [opts.provider];
  const providers = wanted.filter((p) => available.includes(p));
  const skipped = wanted
    .filter((p) => !available.includes(p))
    .map((p) => ({ provider: p, reason: p === "groq" ? "GROQ_API_KEY is not set" : "No Google key set" }));

  const results: Record<string, VoiceCaseResult[]> = {};
  for (const provider of providers) {
    results[provider] = [];
    for (const c of opts.cases) {
      let audio;
      try {
        audio = normalizeAudio(opts.readAudio(c.file));
      } catch (err) {
        results[provider].push({ id: c.id, tags: c.tags, expectedText: c.expectedText, transcript: null, script: "none", score: 0, unclear: true, latencyMs: 0, error: err instanceof Error ? err.message : "Unreadable audio" });
        continue;
      }
      const durationSec = await audioDurationSeconds(audio);
      const r = await transcribeVoice(audio, { provider, durationSec, env, log: () => {} });
      const transcript = r.ok ? r.text : null;
      const row: VoiceCaseResult = {
        id: c.id,
        tags: c.tags,
        expectedText: c.expectedText,
        transcript,
        script: scriptOf(transcript ?? ""),
        score: transcript ? matchScore(c.expectedText, transcript).score : 0,
        unclear: r.ok ? r.unclear : true,
        latencyMs: r.latencyMs,
        error: r.ok ? null : r.error,
      };
      if (transcript && !row.unclear && c.expected?.cart?.length && opts.checkCart) {
        row.cart = await opts.checkCart(transcript, c.expected.cart).catch((err) => ({
          pass: false,
          cart: [],
          problem: err instanceof Error ? err.message : String(err),
        }));
      }
      opts.onProgress?.(`${provider} ${c.id}: ${Math.round(row.score * 100)}% ${row.latencyMs}ms ${row.error ?? ""}`);
      results[provider].push(row);
    }
  }

  const summary: VoiceEvalReport["summary"] = {};
  for (const [provider, rows] of Object.entries(results)) {
    const byTag: Record<string, number> = {};
    for (const tag of VOICE_TAGS) {
      const tagged = rows.filter((r) => r.tags.includes(tag));
      if (tagged.length) byTag[tag] = avg(tagged.map((r) => r.score));
    }
    const byScript: Record<string, number> = {};
    for (const r of rows) byScript[r.script] = (byScript[r.script] ?? 0) + 1;
    const checked = rows.filter((r) => r.cart);
    summary[provider] = {
      averageScore: avg(rows.map((r) => r.score)),
      averageLatencyMs: Math.round(avg(rows.map((r) => r.latencyMs))),
      cartPassed: checked.filter((r) => r.cart!.pass).length,
      cartChecked: checked.length,
      byTag,
      byScript,
      worst: [...rows].sort((a, b) => a.score - b.score).slice(0, 5).map((r) => r.id),
    };
  }
  return { ranAt: new Date().toISOString(), providers, skipped, cases: opts.cases.length, results, summary };
}
