"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * /settings/quick-replies (Phase 10): owner/manager (inbox.quick_replies).
 * User client: RLS + column grants.
 */
const uuid = z.uuid();

const replySchema = z.object({
  id: uuid.nullish(),
  shortcut: z
    .string()
    .trim()
    .toLowerCase()
    .transform((s) => (s.startsWith("/") ? s : `/${s}`))
    .pipe(z.string().regex(/^\/[a-z0-9_-]{1,30}$/, "Use letters/numbers, like /time")),
  text: z.string().trim().min(1, "Write the reply").max(1000),
});

export async function saveQuickReplyAction(input: z.input<typeof replySchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requirePermission("inbox.quick_replies");
    const parsed = replySchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    const db = await createClient();
    let id = v.id ?? null;
    if (id) {
      const { error } = await db.from("quick_replies").update({ shortcut: v.shortcut, text: v.text }).eq("id", id).eq("restaurant_id", ctx.restaurant.id);
      if (error) throw error;
    } else {
      const { count } = await db.from("quick_replies").select("id", { count: "exact", head: true }).eq("restaurant_id", ctx.restaurant.id);
      const { data, error } = await db
        .from("quick_replies")
        .insert({ restaurant_id: ctx.restaurant.id, shortcut: v.shortcut, text: v.text, sort_order: count ?? 0 })
        .select("id")
        .single();
      if (error) throw error;
      id = data.id;
    }
    revalidatePath("/settings/quick-replies");
    revalidatePath("/inbox");
    return { ok: true, data: { id }, message: "Saved" };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      return { ok: false, error: "That shortcut is already used.", fieldErrors: { shortcut: "Already used" } };
    }
    return failure(err, "Couldn't save the reply.");
  }
}

export async function deleteQuickReplyAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("inbox.quick_replies");
    if (!uuid.safeParse(id).success) return { ok: false, error: "Unknown reply." };
    const db = await createClient();
    const { error } = await db.from("quick_replies").delete().eq("id", id).eq("restaurant_id", ctx.restaurant.id);
    if (error) throw error;
    revalidatePath("/settings/quick-replies");
    return { ok: true, message: "Deleted" };
  } catch (err) {
    return failure(err, "Couldn't delete.");
  }
}

export async function reorderQuickRepliesAction(ids: string[]): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("inbox.quick_replies");
    const parsed = z.array(uuid).max(200).safeParse(ids);
    if (!parsed.success) return zodFailure(parsed.error);
    const db = await createClient();
    const results = await Promise.all(parsed.data.map((id, i) => db.from("quick_replies").update({ sort_order: i }).eq("id", id).eq("restaurant_id", ctx.restaurant.id)));
    const bad = results.find((r) => r.error);
    if (bad?.error) throw bad.error;
    revalidatePath("/settings/quick-replies");
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't save the order.");
  }
}

const timingSchema = z.object({
  autoResolveHours: z.number().int().min(1).max(72),
  needsStaffAlertMinutes: z.number().int().min(1).max(60),
});

/** Owner: inbox timings. */
export async function saveInboxTimingsAction(input: z.input<typeof timingSchema>): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("settings.edit");
    const parsed = timingSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const db = await createClient();
    const row = { auto_resolve_hours: parsed.data.autoResolveHours, needs_staff_alert_minutes: parsed.data.needsStaffAlertMinutes };
    const { error } = await db.from("restaurants").update(row).eq("id", ctx.restaurant.id);
    if (error) throw error;
    await writeAuditLog(db, { restaurantId: ctx.restaurant.id, userId: ctx.user.id, action: "restaurant.updated", entityType: "restaurant", entityId: ctx.restaurant.id, newData: row });
    revalidatePath("/settings/quick-replies");
    revalidatePath("/inbox");
    return { ok: true, message: "Saved" };
  } catch (err) {
    return failure(err, "Couldn't save.");
  }
}
