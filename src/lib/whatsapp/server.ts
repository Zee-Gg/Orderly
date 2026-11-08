import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
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
