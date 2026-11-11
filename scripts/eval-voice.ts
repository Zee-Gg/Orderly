/**
 * Voice eval with the REAL transcription providers (the same as the
 * "Run voice eval" button on /dev/voice-tests).
 *
 *   npm run eval:voice [-- --provider groq|google|both]
 *
 * Tests: tests/voice-eval/cases.json + audio/ (record them on /dev/voice-tests).
 * Tests with expected items also run the transcript through the real bot.
 * Report: test-results/voice-eval-<provider>-<date>.json
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import { runVoiceEval } from "../src/lib/bot/voice/eval";
import { createVoiceCartChecker } from "../src/lib/bot/voice/eval-cart";
import { listVoiceCases, readVoiceAudio, saveVoiceReport } from "../src/lib/bot/voice/eval-files";

process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const i = args.indexOf("--provider");
const provider = (i >= 0 ? args[i + 1] : "both") as "groq" | "google" | "both";
if (!["groq", "google", "both"].includes(provider)) {
  console.error("--provider must be groq, google or both");
  process.exit(1);
}

async function main() {
  const cases = listVoiceCases();
  if (!cases.length) throw new Error("No voice tests yet. Record some on /dev/voice-tests.");
  console.log(`Voice eval · ${provider} · ${cases.length} tests`);
  const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const checker = cases.some((c) => c.expected?.cart?.length)
    ? await createVoiceCartChecker(admin, { url: process.env.NEXT_PUBLIC_SUPABASE_URL!, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! })
    : null;
  try {
    const report = await runVoiceEval({ cases, readAudio: readVoiceAudio, provider, checkCart: checker?.check, onProgress: (l) => console.log(`  ${l}`) });
    for (const s of report.skipped) console.log(`  Skipped ${s.provider}: ${s.reason}`);
    for (const [p, s] of Object.entries(report.summary)) {
      console.log(`\n${p}: score ${Math.round(s.averageScore * 100)}% · avg ${(s.averageLatencyMs / 1000).toFixed(2)}s${s.cartChecked ? ` · cart ${s.cartPassed}/${s.cartChecked}` : ""}`);
      console.log(`  by tag: ${Object.entries(s.byTag).map(([t, v]) => `${t} ${Math.round(v * 100)}%`).join(" · ") || "—"}`);
      console.log(`  script: ${Object.entries(s.byScript).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
      console.log(`  worst: ${s.worst.join(", ")}`);
    }
    console.log(`\nReport: ${saveVoiceReport(report, provider)}`);
  } finally {
    await checker?.cleanup();
  }
}

main().catch((err) => {
  console.error("\x1b[31mVoice eval failed:\x1b[0m", err instanceof Error ? err.message : err);
  process.exit(1);
});
