"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Add a "printed" entry to the order timeline. Called by the print page
 * AFTER the print dialog opened (never on page load, so link prefetches
 * can't log fake prints).
 */
export async function recordPrintAction(orderId: string, kind: "kot" | "bill"): Promise<ActionResult> {
  try {
    const parsed = z.object({ orderId: z.uuid(), kind: z.enum(["kot", "bill"]) }).safeParse({ orderId, kind });
    if (!parsed.success) return zodFailure(parsed.error);
    const ctx = await requirePermission(kind === "kot" ? "orders.print_kot" : "orders.print_bill");

    // Access check as the user (RLS + branch access) via the kitchen-safe view.
    const supabase = await createClient();
    const { data: order } = await supabase
      .from("kitchen_orders")
      .select("id, restaurant_id")
      .eq("id", parsed.data.orderId)
      .eq("restaurant_id", ctx.restaurant.id)
      .maybeSingle();
    if (!order) return { ok: false, error: "Order not found." };

    // order_events is server-write only.
    const { error } = await createAdminClient().from("order_events").insert({
      restaurant_id: ctx.restaurant.id,
      order_id: parsed.data.orderId,
      event_type: "printed",
      actor_type: "staff",
      actor_user_id: ctx.user.id,
      data: { kind: parsed.data.kind },
    });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't record the print.");
  }
}

const settingsSchema = z.object({
  width: z.enum(["80mm", "58mm"]),
  header: z.string().trim().max(300, "Keep it under 300 characters"),
  footer: z.string().trim().max(300, "Keep it under 300 characters"),
});

export async function savePrintSettingsAction(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("settings.edit");
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const supabase = await createClient();
    const { error } = await supabase
      .from("restaurants")
      .update({
        receipt_paper_width: parsed.data.width,
        bill_header: parsed.data.header || null,
        bill_footer: parsed.data.footer || null,
      })
      .eq("id", ctx.restaurant.id);
    if (error) throw error;
    await writeAuditLog(supabase, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "restaurant.updated",
      entityType: "restaurant",
      entityId: ctx.restaurant.id,
      newData: { printing: parsed.data },
    });
    revalidatePath("/settings/printing");
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't save printing settings.");
  }
}
