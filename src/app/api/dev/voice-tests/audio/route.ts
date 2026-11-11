import { devToolGuard } from "@/lib/bot/dev-guard";
import { AUDIO_MEDIA_TYPE, detectAudioFormat } from "@/lib/bot/voice/audio";
import { readVoiceAudio } from "@/lib/bot/voice/eval-files";

/** Play a saved voice test (development only + super admin). ?file=<name> */
export async function GET(request: Request) {
  const denied = await devToolGuard();
  if (denied) return denied;
  try {
    const bytes = readVoiceAudio(new URL(request.url).searchParams.get("file") ?? "");
    const format = detectAudioFormat(bytes);
    const type = format === "webm" || format === "unknown" ? "application/octet-stream" : AUDIO_MEDIA_TYPE[format];
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
