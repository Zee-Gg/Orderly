import { devToolGuard } from "@/lib/bot/dev-guard";
import { deleteVoiceCase, listVoiceCases, saveVoiceCase, updateVoiceCase } from "@/lib/bot/voice/eval-files";

/** The live-recorded voice test set (development only + super admin). */
const MAX_BYTES = 10 * 1024 * 1024;

function fail(err: unknown, status = 400) {
  const message = err instanceof Error ? err.message : "Something went wrong";
  return Response.json({ error: message.length > 300 ? "Please check the details." : message }, { status });
}

export async function GET() {
  const denied = await devToolGuard();
  if (denied) return denied;
  return Response.json({ cases: listVoiceCases() });
}

/** multipart: audio + meta (JSON: expectedText, tags, expected?) */
export async function POST(request: Request) {
  const denied = await devToolGuard();
  if (denied) return denied;
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || !audio.size || audio.size > MAX_BYTES) return fail(new Error("Record something first (max 10 MB)"));
    const meta = JSON.parse(String(form.get("meta") ?? "{}"));
    const saved = await saveVoiceCase(new Uint8Array(await audio.arrayBuffer()), meta);
    return Response.json({ case: saved });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(request: Request) {
  const denied = await devToolGuard();
  if (denied) return denied;
  try {
    const { id, ...meta } = await request.json();
    return Response.json({ case: updateVoiceCase(String(id), meta) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(request: Request) {
  const denied = await devToolGuard();
  if (denied) return denied;
  try {
    deleteVoiceCase(new URL(request.url).searchParams.get("id") ?? "");
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
