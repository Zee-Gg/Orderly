import { NextResponse } from "next/server";
import { createCartDraft, createDraftSchema } from "@/lib/menu-page/drafts";
import { clientIp, hashIp, readJson } from "@/lib/menu-page/request";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/public/cart-drafts — the customer menu page sends its cart
 * (choices only). Public, no login: the server re-prices every line, rate
 * limits per IP and returns a short order code for WhatsApp.
 */
const STATUS = { NOT_FOUND: 404, CLOSED: 409, NO_WHATSAPP: 409, RATE_LIMITED: 429, INVALID_LINES: 422 } as const;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await readJson(req, 32 * 1024);
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "Invalid request." }, { status: 400 });
  }
  const parsed = createDraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  try {
    const result = await createCartDraft(createAdminClient(), parsed.data, { ipHash: hashIp(clientIp(req.headers)) });
    return NextResponse.json(result, { status: result.ok ? 200 : STATUS[result.error] });
  } catch (err) {
    console.error("[menu-page] draft failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Something went wrong. Please try again." }, { status: 500 });
  }
}
