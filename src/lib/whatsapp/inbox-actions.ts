"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, type ActionResult } from "@/lib/action-result";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ conversationId: z.uuid() });

/**
 * Staff: give a chat back to the AI bot after a handoff. Conversations have no
 * browser write grants, so this runs with the admin client AFTER the
 * permission check, scoped to the member's restaurant.
 */
export async function turnBotBackOnAction(input: z.input<typeof schema>): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("inbox.bot_toggle");
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Unknown chat." };
    const db = createAdminClient();
    const { data, error } = await db
      .from("whatsapp_conversations")
      .update({ bot_enabled: true, handoff_reason: null, handed_off_at: null, bot_muted_until: null })
      .eq("id", parsed.data.conversationId)
      .eq("restaurant_id", ctx.restaurant.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "This chat isn't available." };
    // The handed-off bot session ends; the customer's next message starts fresh.
    await db
      .from("bot_sessions")
      .update({ status: "abandoned", stage: "done" })
      .eq("restaurant_id", ctx.restaurant.id)
      .eq("conversation_id", parsed.data.conversationId)
      .eq("status", "handed_off");
    await writeAuditLog(await createClient(), {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "whatsapp.bot_resumed",
      entityType: "whatsapp_conversation",
      entityId: parsed.data.conversationId,
    });
    revalidatePath("/inbox");
    return { ok: true, message: "The bot will answer this customer again." };
  } catch (err) {
    return failure(err, "Couldn't turn the bot back on.");
  }
}
