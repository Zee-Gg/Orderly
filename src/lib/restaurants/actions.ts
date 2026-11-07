"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { diff, writeAuditLog } from "@/lib/audit";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import {
  BRANCH_COOKIE,
  RESTAURANT_COOKIE,
  SELECTION_COOKIE_OPTIONS,
} from "@/lib/auth/cookies";
import { requirePermission, requireUser } from "@/lib/auth/session";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  onboardingSchema,
  restaurantProfileSchema,
  slugSchema,
  type OnboardingInput,
} from "@/lib/validation/restaurant";
import { LOGO_BUCKET } from "./logo";

export type SlugStatus = "available" | "taken" | "invalid";

/** Live check for the onboarding form. */
export async function checkSlug(slug: string): Promise<{ status: SlugStatus; message?: string }> {
  await requireUser();
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return { status: "invalid", message: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_slug_available", { p_slug: parsed.data });
  if (error) return { status: "invalid", message: "Couldn't check right now." };
  return data
    ? { status: "available" }
    : { status: "taken", message: "This link is taken. Try adding your area or city." };
}

/**
 * Onboarding: creates restaurant + first branch + owner membership through
 * the create_restaurant_with_owner RPC (one transaction), then selects it.
 */
export async function createRestaurant(input: OnboardingInput): Promise<ActionResult<{ id: string }>> {
  try {
    await requireUser();
    const parsed = onboardingSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;

    const supabase = await createClient();
    const { data: restaurantId, error } = await supabase.rpc("create_restaurant_with_owner", {
      p_name: v.name,
      p_slug: v.slug,
      p_city: v.city,
      p_phone: v.phone,
      p_branch_name: v.branchName,
      p_branch_address: v.branchAddress,
      p_branch_area: v.branchArea,
      p_opening_hours: v.openingHours,
    });
    if (error) {
      if (error.code === "23505") {
        return {
          ok: false,
          error: "This menu link was just taken. Please choose another.",
          fieldErrors: { slug: "This link is taken" },
        };
      }
      if (error.code === "P0001") return { ok: false, error: error.message };
      throw error;
    }

    const cookieStore = await cookies();
    cookieStore.set(RESTAURANT_COOKIE, restaurantId, SELECTION_COOKIE_OPTIONS);
    cookieStore.delete(BRANCH_COOKIE);
    return { ok: true, data: { id: restaurantId } };
  } catch (err) {
    return failure(err, "Couldn't create your restaurant. Please try again.");
  }
}

/** Save an uploaded logo (already in storage under {restaurant_id}/) as the restaurant's logo. */
export async function setRestaurantLogo(path: string): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await requirePermission("settings.edit");
    if (!path.startsWith(`${ctx.restaurant.id}/`) || path.includes("..")) {
      return { ok: false, error: "That logo file isn't valid." };
    }
    const supabase = await createClient();
    const url = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
    const { error } = await supabase
      .from("restaurants")
      .update({ logo_url: url })
      .eq("id", ctx.restaurant.id);
    if (error) throw error;

    await writeAuditLog(supabase, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "restaurant.updated",
      entityType: "restaurant",
      entityId: ctx.restaurant.id,
      oldData: { logo_url: ctx.restaurant.logo_url },
      newData: { logo_url: url },
    });
    revalidatePath("/", "layout");
    return { ok: true, data: { url } };
  } catch (err) {
    return failure(err, "Couldn't save the logo. Please try again.");
  }
}

export async function updateRestaurantProfile(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("settings.edit");
    const parsed = restaurantProfileSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);

    // A logo URL must point at this restaurant's own folder in our bucket.
    const logoPrefix = `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${LOGO_BUCKET}/${ctx.restaurant.id}/`;
    if (parsed.data.logoUrl && !parsed.data.logoUrl.startsWith(logoPrefix)) {
      return { ok: false, error: "That logo isn't valid.", fieldErrors: { logoUrl: "Upload the logo again" } };
    }

    const supabase = await createClient();
    const { data: before } = await supabase
      .from("restaurants")
      .select("name, city, phone, whatsapp_number, logo_url")
      .eq("id", ctx.restaurant.id)
      .single();
    if (!before) return { ok: false, error: "Restaurant not found." };

    const row = {
      name: parsed.data.name,
      city: parsed.data.city || null,
      phone: parsed.data.phone || null,
      whatsapp_number: parsed.data.whatsappNumber || null,
      logo_url: parsed.data.logoUrl || null,
    };
    const changes = diff(before, row);
    if (!changes.changed) return { ok: true, message: "Nothing to save" };

    const { error } = await supabase.from("restaurants").update(row).eq("id", ctx.restaurant.id);
    if (error) throw error;

    await writeAuditLog(supabase, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "restaurant.updated",
      entityType: "restaurant",
      entityId: ctx.restaurant.id,
      oldData: changes.oldData,
      newData: changes.newData,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't save. Please try again.");
  }
}
