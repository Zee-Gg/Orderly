"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { STATUS_MESSAGE_KEYS } from "./order-messages";

const schema = z.object(Object.fromEntries(STATUS_MESSAGE_KEYS.map((k) => [k, z.boolean()])) as Record<
  (typeof STATUS_MESSAGE_KEYS)[number],
  z.ZodBoolean
>);

/** Owner: switch each order status message on/off. */
export async function saveStatusMessagesAction(input: Record<string, boolean>): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("settings.edit");
    const parsed = schema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    // User client: RLS (owner only) + column grant.
    const supabase = await createClient();
    const { error } = await supabase
      .from("restaurants")
      .update({ whatsapp_status_messages: parsed.data })
      .eq("id", ctx.restaurant.id);
    if (error) throw error;
    await writeAuditLog(supabase, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "restaurant.updated",
      entityType: "restaurant",
      entityId: ctx.restaurant.id,
      newData: { whatsapp_status_messages: parsed.data },
    });
    revalidatePath("/settings/whatsapp");
    return { ok: true, message: "Saved" };
  } catch (err) {
    return failure(err, "Couldn't save the message settings.");
  }
}
