import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { audioDurationSeconds, normalizeAudio } from "./audio";
import { VOICE_TAGS, type VoiceCase } from "./eval";

/**
 * The voice test set on disk (development only): recordings in
 * tests/voice-eval/audio/, cases in tests/voice-eval/cases.json.
 * Ids and file names are generated here and checked, so nothing outside that
 * folder can ever be read or written.
 */
export const VOICE_EVAL_DIR = path.join(process.cwd(), "tests", "voice-eval");
const AUDIO_DIR = path.join(VOICE_EVAL_DIR, "audio");
const CASES_FILE = path.join(VOICE_EVAL_DIR, "cases.json");

const ID = /^v-[a-z0-9]{6,24}$/;
const FILE = /^[a-z0-9-]{1,40}\.(ogg|wav|mp4|mp3)$/;

export const voiceCaseInputSchema = z.object({
  expectedText: z.string().trim().min(1, "Type what you said").max(500),
  tags: z.array(z.enum(VOICE_TAGS)).max(VOICE_TAGS.length).default([]),
  expected: z
    .object({
      cart: z.array(z.object({ item: z.string().trim().min(1).max(80), qty: z.number().int().min(1).max(99) })).max(20).optional(),
      behavior: z.string().trim().max(200).optional(),
    })
    .optional(),
});
export type VoiceCaseInput = z.input<typeof voiceCaseInputSchema>;

export function listVoiceCases(): VoiceCase[] {
  if (!existsSync(CASES_FILE)) return [];
  const cases = JSON.parse(readFileSync(CASES_FILE, "utf8")) as VoiceCase[];
  return cases.filter((c) => ID.test(c.id) && FILE.test(c.file));
}

function writeCases(cases: VoiceCase[]) {
  mkdirSync(VOICE_EVAL_DIR, { recursive: true });
  writeFileSync(CASES_FILE, `${JSON.stringify(cases, null, 2)}\n`);
}

export function readVoiceAudio(file: string): Uint8Array {
  if (!FILE.test(file)) throw new Error("Bad file name");
  return new Uint8Array(readFileSync(path.join(AUDIO_DIR, file)));
}

/** Save a recording (stored as Ogg/Opus, like WhatsApp) + its expected text. */
export async function saveVoiceCase(bytes: Uint8Array, input: VoiceCaseInput): Promise<VoiceCase> {
  const meta = voiceCaseInputSchema.parse(input);
  const audio = normalizeAudio(bytes);
  const id = `v-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const file = `${id}.${audio.format}`;
  mkdirSync(AUDIO_DIR, { recursive: true });
  writeFileSync(path.join(AUDIO_DIR, file), audio.bytes);
  const c: VoiceCase = {
    id,
    file,
    expectedText: meta.expectedText,
    tags: meta.tags,
    ...(meta.expected && (meta.expected.cart?.length || meta.expected.behavior) ? { expected: meta.expected } : {}),
    durationSec: await audioDurationSeconds(audio),
    createdAt: new Date().toISOString(),
  };
  writeCases([...listVoiceCases(), c]);
  return c;
}

export function updateVoiceCase(id: string, input: VoiceCaseInput): VoiceCase {
  if (!ID.test(id)) throw new Error("Bad id");
  const meta = voiceCaseInputSchema.parse(input);
  const cases = listVoiceCases();
  const c = cases.find((x) => x.id === id);
  if (!c) throw new Error("Test not found");
  c.expectedText = meta.expectedText;
  c.tags = meta.tags;
  if (meta.expected && (meta.expected.cart?.length || meta.expected.behavior)) c.expected = meta.expected;
  else delete c.expected;
  writeCases(cases);
  return c;
}

export function deleteVoiceCase(id: string) {
  if (!ID.test(id)) throw new Error("Bad id");
  const cases = listVoiceCases();
  const c = cases.find((x) => x.id === id);
  if (!c) return;
  rmSync(path.join(AUDIO_DIR, c.file), { force: true });
  writeCases(cases.filter((x) => x.id !== id));
}

export function saveVoiceReport(report: unknown, provider: string): string {
  const dir = path.join(process.cwd(), "test-results");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `voice-eval-${provider}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  return path.relative(process.cwd(), file);
}
