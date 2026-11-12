"use server";

import { revalidatePath } from "next/cache";
import { revalidatePublicMenu } from "@/lib/menu/public-cache";
import { z } from "zod";
import { diff, writeAuditLog } from "@/lib/audit";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { branchSchema, type BranchInput } from "@/lib/validation/restaurant";

/** Top bar open/closed switch for one branch. */
export async function setBranchOpen(branchId: string, isOpen: boolean): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("branches.toggle_open");
    const parsed = z.object({ branchId: z.uuid(), isOpen: z.boolean() }).safeParse({ branchId, isOpen });
    if (!parsed.success) return zodFailure(parsed.error);
    if (!ctx.branches.some((b) => b.id === parsed.data.branchId)) {
      return { ok: false, error: "That branch isn't available." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("branches")
      .update({ is_open: parsed.data.isOpen })
      .eq("id", parsed.data.branchId)
      .select("id");
    if (error) throw error;
    if (!data.length) return { ok: false, error: "You can't change this branch." };

    revalidatePath("/", "layout");
    revalidatePublicMenu(ctx.restaurant.id);
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't change open/closed. Please try again.");
  }
}

function toRow(input: z.output<typeof branchSchema>) {
  return {
    name: input.name,
    address: input.address || null,
    area: input.area || null,
    city: input.city || null,
    phone: input.phone || null,
    opening_hours: input.openingHours,
    is_active: input.isActive,
    default_delivery_fee: input.deliveryFee,
    minimum_order: input.minimumOrder,
  };
}

export async function createBranch(input: BranchInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requirePermission("branches.manage");
    if (!ctx.isRestaurantWide) {
      return { ok: false, error: "Only people with access to all branches can add a branch." };
    }
    const parsed = branchSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);

    const supabase = await createClient();
    const row = toRow(parsed.data);
    const { data, error } = await supabase
      .from("branches")
      .insert({ ...row, restaurant_id: ctx.restaurant.id })
      .select("id")
      .single();
    if (error) throw error;

    await writeAuditLog(supabase, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "branch.created",
      entityType: "branch",
      entityId: data.id,
      newData: row,
    });
    revalidatePath("/", "layout");
    revalidatePublicMenu(ctx.restaurant.id);
    return { ok: true, data: { id: data.id } };
  } catch (err) {
    return failure(err, "Couldn't add the branch. Please try again.");
  }
}

export async function updateBranch(branchId: string, input: BranchInput): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("branches.manage");
    const id = z.uuid().safeParse(branchId);
    const parsed = branchSchema.safeParse(input);
    if (!id.success) return { ok: false, error: "That branch isn't available." };
    if (!parsed.success) return zodFailure(parsed.error);

    const supabase = await createClient();
    const { data: before } = await supabase
      .from("branches")
      .select("name, address, area, city, phone, opening_hours, is_active, default_delivery_fee, minimum_order")
      .eq("id", id.data)
      .eq("restaurant_id", ctx.restaurant.id)
      .single();
    if (!before) return { ok: false, error: "That branch isn't available." };

    const row = toRow(parsed.data);
    const { data, error } = await supabase
      .from("branches")
      .update(row)
      .eq("id", id.data)
      .select("id");
    if (error) throw error;
    if (!data.length) return { ok: false, error: "You can't edit this branch." };

    const changes = diff(
      { ...before, opening_hours: JSON.stringify(before.opening_hours) },
      { ...row, opening_hours: JSON.stringify(row.opening_hours) },
    );
    if (changes.changed) {
      await writeAuditLog(supabase, {
        restaurantId: ctx.restaurant.id,
        userId: ctx.user.id,
        action: "branch.updated",
        entityType: "branch",
        entityId: id.data,
        oldData: changes.oldData,
        newData: changes.newData,
      });
    }
    revalidatePath("/", "layout");
    revalidatePublicMenu(ctx.restaurant.id);
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't save the branch. Please try again.");
  }
}
