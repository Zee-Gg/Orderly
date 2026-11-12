import { NextResponse } from "next/server";
import { PermissionError, requirePermission } from "@/lib/auth/session";
import { BOT_MEDIA_BUCKET } from "@/lib/bot/media-constants";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/inbox/upload — a photo staff send to a customer (Phase 10).
 * The browser already shrank it to a JPEG. Stored in the public bot-media
 * bucket (WhatsApp fetches images by URL) at {restaurant_id}/inbox/….
 */
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };

export async function POST(req: Request) {
  let ctx;
  try {
    ctx = await requirePermission("inbox.reply");
  } catch (err) {
    if (err instanceof PermissionError) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    throw err;
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a photo" }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Send a JPG or PNG photo" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Photo is too big (max 5 MB)" }, { status: 400 });

  const admin = createAdminClient();
  const path = `${ctx.restaurant.id}/inbox/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage.from(BOT_MEDIA_BUCKET).upload(path, new Uint8Array(await file.arrayBuffer()), {
    contentType: file.type,
    cacheControl: "31536000",
  });
  if (error) {
    console.error("[inbox] upload failed", error.message);
    return NextResponse.json({ error: "Upload failed. Try again." }, { status: 500 });
  }
  return NextResponse.json({ url: admin.storage.from(BOT_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl });
}
