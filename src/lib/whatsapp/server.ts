import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSender } from "./send";
import { createSupabaseStore } from "./store";

/**
 * Server-side WhatsApp helpers bound to the admin client.
 * Call ONLY from webhooks or after a permission check.
 */
export function whatsappDeps() {
  return { store: createSupabaseStore(createAdminClient()) };
}

/** Send a text inside the 24h window (saves the message either way). */
export function sendText(restaurantId: string, toWaId: string, text: string) {
  return createSender(whatsappDeps()).sendText(restaurantId, toWaId, text);
}
