import { z } from "zod";
import { devToolGuard } from "@/lib/bot/dev-guard";
import { runBotTurn } from "@/lib/bot/agent";
import { toPlaygroundTurn, type PlaygroundTurn, type PlaygroundVoice } from "@/lib/bot/playground-shared";
import { createSupabaseBotStore } from "@/lib/bot/store";
import { t } from "@/lib/bot/texts";
import { handleVoice, VOICE_MARKER } from "@/lib/bot/voice/handle";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Bot playground mic (development only + super admin). The SAME voice path as
 * WhatsApp: duration check → transcription → bot. A route (not a server
 * action) because recordings can be bigger than the 1 MB action limit.
 */
const MAX_BYTES = 10 * 1024 * 1024;

const fields = z.object({
  restaurantId: z.uuid(),
  branchId: z.uuid(),
  sessionId: z.uuid(),
  customerId: z.uuid(),
  provider: z.enum(["groq", "google"]).optional(),
});

export async function POST(request: Request) {
  const denied = await devToolGuard();
  if (denied) return denied;

  const form = await request.formData();
  const audio = form.get("audio");
  const parsed = fields.safeParse(Object.fromEntries([...form.entries()].filter(([k]) => k !== "audio")));
  if (!parsed.success || !(audio instanceof Blob)) return Response.json({ error: "Missing audio or chat details" }, { status: 400 });
  if (audio.size === 0 || audio.size > MAX_BYTES) return Response.json({ error: "Recording is empty or too big" }, { status: 400 });
  const v = parsed.data;

  const db = createAdminClient();
  const store = createSupabaseBotStore(db);
  const outcome = await handleVoice(new Uint8Array(await audio.arrayBuffer()), {
    restaurantId: v.restaurantId,
    sessionId: v.sessionId,
    provider: v.provider ?? null,
    logTurn: (row) => store.logTurn(row),
  });

  const r = outcome.kind === "too_long" ? null : outcome.result;
  const voice: PlaygroundVoice = {
    kind: outcome.kind,
    transcript: outcome.kind === "ok" ? outcome.transcript : r?.ok ? r.text || null : null,
    provider: r?.provider ?? null,
    model: r?.model ?? null,
    keySource: r?.keySource ?? null,
    transcribeMs: r?.latencyMs ?? null,
    durationSec: outcome.durationSec,
    converted: outcome.kind === "ok" ? outcome.converted : false,
    note: r?.note ?? null,
    reason: outcome.kind === "unclear" ? outcome.reason : null,
  };

  // Over 2 minutes: same reply as WhatsApp, no bot turn.
  if (outcome.kind === "too_long") {
    const session = await store.getSession(v.restaurantId, v.sessionId);
    return Response.json({ voice, turn: null, replyText: t(session?.language ?? "roman_urdu").voiceTooLong });
  }

  const result = await runBotTurn(
    {
      restaurantId: v.restaurantId,
      branchId: v.branchId,
      sessionId: v.sessionId,
      customerId: v.customerId,
      customerMessages: [outcome.kind === "ok" ? `${VOICE_MARKER} ${outcome.transcript}` : `${VOICE_MARKER} (not understood)`],
      voice: outcome.kind === "ok",
      voiceFailed: outcome.kind === "unclear",
    },
    { store },
  );
  const turn: PlaygroundTurn = toPlaygroundTurn(result);
  return Response.json({ voice, turn, replyText: turn.replyText });
}
