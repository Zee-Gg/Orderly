import "server-only";
import { createSupabaseBotStore } from "@/lib/bot/store";
import { createSupabaseChannelStore } from "@/lib/bot/whatsapp/channel";
import { createBotPipeline } from "@/lib/bot/whatsapp/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InboundHook } from "./process";
import { createSender } from "./send";
import { createSupabaseStore } from "./store";

/**
 * Server-side WhatsApp helpers bound to the admin client.
 * Call ONLY from webhooks or after a permission check.
 * Every helper checks the 24-hour window first (no templates): outside it the
 * message is saved as "skipped" and not sent.
 */
export function whatsappDeps() {
  return { store: createSupabaseStore(createAdminClient()) };
}

/** All send helpers: sendText, sendImage, sendDocument, sendLocation, sendInteractiveButtons, sendInteractiveList. */
export function whatsappSender() {
  return createSender(whatsappDeps());
}

/** Send a text inside the 24h window (saves the message either way). */
export function sendText(restaurantId: string, toWaId: string, text: string) {
  return whatsappSender().sendText(restaurantId, toWaId, text);
}

/** The AI bot for inbound WhatsApp messages (Phase 7A-2). Used by the webhook. */
export function whatsappBotHook(): InboundHook {
  const db = createAdminClient();
  const sender = createSender({ store: createSupabaseStore(db) });
  const pipeline = createBotPipeline({
    channel: createSupabaseChannelStore(db),
    botStore: createSupabaseBotStore(db),
    sender: {
      sendText: (r, to, text) => sender.sendText(r, to, text),
      sendInteractiveButtons: (r, to, text, buttons) => sender.sendInteractiveButtons(r, to, text, buttons),
    },
    log: (step, details) => console.log(`[bot] ${step}`, details ? JSON.stringify(details) : ""),
  });
  return (input) => pipeline.handleInbound(input);
}
