import { after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";
import { consoleProcessLog, processWebhookPayload } from "@/lib/whatsapp/process";
import { whatsappBotHook, whatsappDeps } from "@/lib/whatsapp/server";
import { safeEqual, verifyWebhookSignature } from "@/lib/whatsapp/signature";

/**
 * WhatsApp Cloud API webhook. Public (no session): security is the
 * X-Hub-Signature-256 check. Restaurant = the receiving phone_number_id.
 */

// Meta's one-time "Verify and save" handshake.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ok =
    params.get("hub.mode") === "subscribe" &&
    safeEqual(params.get("hub.verify_token"), process.env.WHATSAPP_VERIFY_TOKEN);
  if (!ok) {
    console.warn("[whatsapp] verify FAILED: hub.verify_token does not match WHATSAPP_VERIFY_TOKEN");
    return new Response("Forbidden", { status: 403 });
  }
  console.log("[whatsapp] verify ok");
  return new Response(params.get("hub.challenge") ?? "", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error("[whatsapp] WHATSAPP_APP_SECRET is not set");
    return new Response("Not configured", { status: 500 });
  }

  const rawBody = await request.text();
  console.log("[whatsapp] received", JSON.stringify({ bytes: rawBody.length }));
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(rawBody, signature, appSecret)) {
    console.warn(
      "[whatsapp] signature FAILED",
      signature ? "(check WHATSAPP_APP_SECRET = Meta App settings → Basic → App secret)" : "(no X-Hub-Signature-256 header)",
    );
    return new Response("Invalid signature", { status: 401 });
  }
  console.log("[whatsapp] signature ok");

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Keep the raw delivery first, so nothing is ever lost.
  const db = createAdminClient();
  const { data: event, error } = await db
    .from("whatsapp_webhook_events")
    .insert({ raw: payload as Json })
    .select("id")
    .single();
  if (error || !event) {
    console.error("[whatsapp] could not log webhook", error?.message);
    // 500 → Meta retries later; duplicates are ignored by wa_message_id.
    return new Response("Try again", { status: 500 });
  }
  console.log("[whatsapp] event logged", JSON.stringify({ eventId: event.id }));

  // Answer Meta quickly; process after the response is sent.
  after(async () => {
    let errorText: string | null = null;
    try {
      const summary = await processWebhookPayload({ ...whatsappDeps(), onInbound: whatsappBotHook() }, payload, consoleProcessLog);
      const { errors, ...counts } = summary;
      console.log("[whatsapp] done", JSON.stringify({ eventId: event.id, ...counts, errors: errors.length }));
      errorText = summary.errors.length ? summary.errors.join("\n").slice(0, 2000) : null;
    } catch (err) {
      errorText = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    }
    if (errorText) console.error("[whatsapp] webhook", event.id, errorText);
    await db
      .from("whatsapp_webhook_events")
      .update({ processed_at: new Date().toISOString(), error: errorText })
      .eq("id", event.id);
  });

  return new Response("EVENT_RECEIVED", { status: 200 });
}
