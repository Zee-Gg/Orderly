"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission, type CurrentContext } from "@/lib/auth/session";
import { revalidatePublicMenu } from "@/lib/menu/public-cache";
import { createClient } from "@/lib/supabase/server";

/**
 * /settings/delivery (Phase 9): zones per branch + radius + unlisted-area
 * policy. Owner/manager (delivery.manage); user client (RLS + column grants).
 * Zones are never deleted (orders reference them): switch them off.
 */
const uuid = z.uuid();

function done(ctx: CurrentContext) {
  revalidatePath("/settings/delivery");
  revalidatePath("/orders", "layout");
  revalidatePublicMenu(ctx.restaurant.id); // the menu page shows area fees
}

function ownBranch(ctx: CurrentContext, branchId: string) {
  return ctx.branches.some((b) => b.id === branchId);
}

const zoneSchema = z.object({
  id: uuid.nullish(),
  branchId: uuid,
  name: z.string().trim().min(2, "Enter the area name").max(80),
  aliases: z.array(z.string().trim().min(1).max(60)).max(30),
  deliveryFee: z.number().int().min(0, "Can't be negative").max(10_000_000),
  minimumOrder: z.number().int().min(0, "Can't be negative").max(100_000_000),
  estimatedMinutes: z.number().int().min(1).max(600).nullable(),
  isActive: z.boolean(),
});

export async function saveZoneAction(input: z.input<typeof zoneSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requirePermission("delivery.manage");
    const parsed = zoneSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    if (!ownBranch(ctx, v.branchId)) return { ok: false, error: "Choose your branch." };
    const db = await createClient();
    const row = {
      name: v.name,
      aliases: [...new Set(v.aliases.map((a) => a.trim()).filter(Boolean))],
      delivery_fee: v.deliveryFee,
      minimum_order: v.minimumOrder,
      estimated_minutes: v.estimatedMinutes,
      is_active: v.isActive,
    };
    let id = v.id ?? null;
    if (id) {
      const { error } = await db.from("delivery_zones").update(row).eq("id", id).eq("restaurant_id", ctx.restaurant.id);
      if (error) throw error;
    } else {
      const { count } = await db.from("delivery_zones").select("id", { count: "exact", head: true }).eq("branch_id", v.branchId);
      const { data, error } = await db
        .from("delivery_zones")
        .insert({ ...row, restaurant_id: ctx.restaurant.id, branch_id: v.branchId, sort_order: count ?? 0 })
        .select("id")
        .single();
      if (error) throw error;
      id = data.id;
    }
    await writeAuditLog(db, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "branch.updated",
      entityType: "delivery_zone",
      entityId: id,
      newData: row,
    });
    done(ctx);
    return { ok: true, data: { id }, message: "Area saved" };
  } catch (err) {
    return failure(err, "Couldn't save the area.");
  }
}

export async function reorderZonesAction(ids: string[]): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("delivery.manage");
    const parsed = z.array(uuid).max(300).safeParse(ids);
    if (!parsed.success) return zodFailure(parsed.error);
    const db = await createClient();
    const results = await Promise.all(parsed.data.map((id, i) => db.from("delivery_zones").update({ sort_order: i }).eq("id", id).eq("restaurant_id", ctx.restaurant.id)));
    const bad = results.find((r) => r.error);
    if (bad?.error) throw bad.error;
    done(ctx);
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't save the new order.");
  }
}

const settingsSchema = z.object({
  branchId: uuid,
  maxDeliveryRadiusKm: z.number().min(0.5).max(100).nullable(),
  unlistedAreaPolicy: z.enum(["reject", "default_fee"]),
});

export async function saveDeliverySettingsAction(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("delivery.manage");
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    if (!ownBranch(ctx, v.branchId)) return { ok: false, error: "Choose your branch." };
    const db = await createClient();
    const row = { max_delivery_radius_km: v.maxDeliveryRadiusKm === null ? null : Math.round(v.maxDeliveryRadiusKm * 10) / 10, unlisted_area_policy: v.unlistedAreaPolicy };
    const { error } = await db.from("branches").update(row).eq("id", v.branchId).eq("restaurant_id", ctx.restaurant.id);
    if (error) throw error;
    await writeAuditLog(db, { restaurantId: ctx.restaurant.id, userId: ctx.user.id, action: "branch.updated", entityType: "branch", entityId: v.branchId, newData: row });
    done(ctx);
    return { ok: true, message: "Saved" };
  } catch (err) {
    return failure(err, "Couldn't save.");
  }
}

/** Owner: tell the customer the rider's phone in "on the way" messages. */
export async function saveShareRiderPhoneAction(share: boolean): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("settings.edit");
    const db = await createClient();
    const { error } = await db.from("restaurants").update({ share_rider_phone_with_customer: !!share }).eq("id", ctx.restaurant.id);
    if (error) throw error;
    await writeAuditLog(db, { restaurantId: ctx.restaurant.id, userId: ctx.user.id, action: "restaurant.updated", entityType: "restaurant", entityId: ctx.restaurant.id, newData: { share_rider_phone_with_customer: !!share } });
    revalidatePath("/settings/delivery");
    return { ok: true, message: "Saved" };
  } catch (err) {
    return failure(err, "Couldn't save.");
  }
}
