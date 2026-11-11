import { z } from "zod";
import { devToolGuard } from "@/lib/bot/dev-guard";
import { runVoiceEval } from "@/lib/bot/voice/eval";
import { createVoiceCartChecker } from "@/lib/bot/voice/eval-cart";
import { listVoiceCases, readVoiceAudio, saveVoiceReport } from "@/lib/bot/voice/eval-files";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Run the voice eval from /dev/voice-tests (development only + super admin).
 * Real transcription providers; tests with expected items also run the real bot.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = await devToolGuard();
  if (denied) return denied;
  const parsed = z.object({ provider: z.enum(["groq", "google", "both"]) }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Choose groq, google or both" }, { status: 400 });
  const cases = listVoiceCases();
  if (!cases.length) return Response.json({ error: "Record a test first" }, { status: 400 });

  const checker = cases.some((c) => c.expected?.cart?.length)
    ? await createVoiceCartChecker(createAdminClient(), {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      })
    : null;
  try {
    const report = await runVoiceEval({ cases, readAudio: readVoiceAudio, provider: parsed.data.provider, checkCart: checker?.check });
    const file = saveVoiceReport(report, parsed.data.provider);
    return Response.json({ report, file });
  } finally {
    await checker?.cleanup();
  }
}
