import type { TranscribeProvider } from "../config";

/** Voice eval types + tags (no server code: safe to import in the browser). */
export const VOICE_TAGS = ["noise", "accent", "mixed_language", "fast", "correction", "question"] as const;
export type VoiceTag = (typeof VOICE_TAGS)[number];

export type VoiceCase = {
  id: string;
  /** File name inside tests/voice-eval/audio/. */
  file: string;
  /** What was really said. */
  expectedText: string;
  tags: VoiceTag[];
  /** Optional: what the bot should put in the cart / do. */
  expected?: { cart?: { item: string; qty: number }[]; behavior?: string };
  durationSec?: number | null;
  createdAt: string;
};

export type CartCheck = (transcript: string, expected: { item: string; qty: number }[]) => Promise<{ pass: boolean; cart: string[]; problem: string | null }>;

export type VoiceCaseResult = {
  id: string;
  tags: VoiceTag[];
  expectedText: string;
  transcript: string | null;
  script: "urdu" | "latin" | "mixed" | "none";
  score: number;
  unclear: boolean;
  latencyMs: number;
  error: string | null;
  cart?: { pass: boolean; cart: string[]; problem: string | null };
};

export type VoiceEvalReport = {
  ranAt: string;
  providers: TranscribeProvider[];
  skipped: { provider: string; reason: string }[];
  cases: number;
  results: Record<string, VoiceCaseResult[]>;
  summary: Record<string, { averageScore: number; averageLatencyMs: number; cartPassed: number; cartChecked: number; byTag: Record<string, number>; byScript: Record<string, number>; worst: string[] }>;
};

