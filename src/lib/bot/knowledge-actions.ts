"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission, type CurrentContext } from "@/lib/auth/session";
import { revalidatePublicMenu } from "@/lib/menu/public-cache";
import { createClient } from "@/lib/supabase/server";
import { startOfLocalDay } from "@/lib/time";
import { coordinatesFromMapsUrl, FAQ_SUGGESTIONS, isShortMapsLink } from "./knowledge";
import { BOT_IMAGE_MAX_BYTES, BOT_MEDIA_BUCKET, BOT_PDF_MAX_BYTES } from "./media-constants";

/**
 * /settings/bot (Phase 7C): menu images, offers, FAQs, restaurant info.
 * Every action: requirePermission("bot.manage") (owner/manager) → Zod → user
 * client (RLS + column grants are the real boundary).
 */

const uuid = z.string().uuid();
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .nullish()
    .transform((v) => v || null);

function revalidate(restaurantId?: string) {
  revalidatePath("/settings/bot");
  revalidatePath("/menu");
  if (restaurantId) revalidatePublicMenu(restaurantId); // offers, location, payment info show on /m/[slug]
}

/** A branch the member may manage, or null ("All branches", restaurant-wide members only). */
function checkBranch(ctx: CurrentContext, branchId: string | null): string | null {
  if (branchId === null) {
    if (!ctx.isRestaurantWide) throw Object.assign(new Error("Choose your branch."), { name: "BranchError" });
    return null;
  }
  if (!ctx.branches.some((b) => b.id === branchId)) throw Object.assign(new Error("Unknown branch."), { name: "BranchError" });
  return branchId;
}

function friendly(err: unknown, fallback: string): ActionResult<never> {
  if (err instanceof Error && err.name === "BranchError") return { ok: false, error: err.message };
  return failure(err, fallback);
}

async function audit(ctx: CurrentContext, db: Awaited<ReturnType<typeof createClient>>, entityType: string, entityId: string, newData: Record<string, unknown>) {
  await writeAuditLog(db, {
    restaurantId: ctx.restaurant.id,
    userId: ctx.user.id,
    action: "bot.knowledge_changed",
    entityType,
    entityId,
    newData: newData as never,
  });
}

// ---------------------------------------------------------------------------
// Menu images / PDF (the browser uploads to Storage first; storage RLS checks the folder)
// ---------------------------------------------------------------------------

const mediaSchema = z
  .object({
    type: z.enum(["image", "pdf"]),
    storagePath: z.string().trim().min(10).max(300),
    fileName: optText(200),
    sizeBytes: z.number().int().positive(),
    branchId: uuid.nullable(),
  })
  .refine((v) => v.sizeBytes <= (v.type === "image" ? BOT_IMAGE_MAX_BYTES * 1.05 : BOT_PDF_MAX_BYTES), {
    message: "File is too big",
    path: ["sizeBytes"],
  });

export async function addMenuMediaAction(input: z.input<typeof mediaSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requirePermission("bot.manage");
    const parsed = mediaSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    const ext = v.type === "pdf" ? /\.pdf$/i : /\.(jpe?g|png)$/i;
    if (!v.storagePath.startsWith(`${ctx.restaurant.id}/menu/`) || !ext.test(v.storagePath) || v.storagePath.includes("..")) {
      return { ok: false, error: "Upload the file again." };
    }
    const db = await createClient();
    const { count } = await db.from("menu_media").select("id", { count: "exact", head: true }).eq("restaurant_id", ctx.restaurant.id);
    const { data, error } = await db
      .from("menu_media")
      .insert({
        restaurant_id: ctx.restaurant.id,
        branch_id: checkBranch(ctx, v.branchId),
        type: v.type,
        storage_path: v.storagePath,
        file_name: v.fileName,
        size_bytes: v.sizeBytes,
        sort_order: count ?? 0,
      })
      .select("id")
      .single();
    if (error) throw error;
    await audit(ctx, db, "menu_media", data.id, { added: v.type, file: v.fileName });
    revalidate(ctx.restaurant.id);
    return { ok: true, data: { id: data.id }, message: "Uploaded" };
  } catch (err) {
    return friendly(err, "Couldn't save the upload. Please try again.");
  }
}

const mediaUpdateSchema = z.object({ id: uuid, branchId: uuid.nullable().optional(), isActive: z.boolean().optional() });

export async function updateMenuMediaAction(input: z.input<typeof mediaUpdateSchema>): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("bot.manage");
    const parsed = mediaUpdateSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    const db = await createClient();
    const { error } = await db
      .from("menu_media")
      .update({
        ...(v.branchId !== undefined ? { branch_id: checkBranch(ctx, v.branchId) } : {}),
        ...(v.isActive !== undefined ? { is_active: v.isActive } : {}),
      })
      .eq("id", v.id)
      .eq("restaurant_id", ctx.restaurant.id);
    if (error) throw error;
    revalidate(ctx.restaurant.id);
    return { ok: true, message: "Saved" };
  } catch (err) {
    return friendly(err, "Couldn't save. Please try again.");
  }
}

/** Saves a new order for any list on this page (ids in the new order). */
async function reorder(table: "menu_media" | "offers" | "restaurant_faqs", ids: string[]): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("bot.manage");
    const parsed = z.array(uuid).max(200).safeParse(ids);
    if (!parsed.success) return zodFailure(parsed.error);
    const db = await createClient();
    const results = await Promise.all(
      parsed.data.map((id, i) => db.from(table).update({ sort_order: i }).eq("id", id).eq("restaurant_id", ctx.restaurant.id)),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw failed.error;
    revalidate(ctx.restaurant.id);
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't save the new order.");
  }
}

export async function reorderMenuMediaAction(ids: string[]) {
  return reorder("menu_media", ids);
}

/** Remove an uploaded menu image/PDF (row + file). Nothing an order references. */
export async function removeMenuMediaAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("bot.manage");
    if (!uuid.safeParse(id).success) return { ok: false, error: "Unknown file." };
    const db = await createClient();
    const { data, error } = await db
      .from("menu_media")
      .delete()
      .eq("id", id)
      .eq("restaurant_id", ctx.restaurant.id)
      .select("storage_path, file_name")
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const { error: rm } = await db.storage.from(BOT_MEDIA_BUCKET).remove([data.storage_path]);
      if (rm) console.error("[bot] couldn't remove menu file", rm.message);
      await audit(ctx, db, "menu_media", id, { removed: data.file_name });
    }
    revalidate(ctx.restaurant.id);
    return { ok: true, message: "Removed" };
  } catch (err) {
    return failure(err, "Couldn't remove it. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Offers (always a menu item: the price comes from the pricing engine)
// ---------------------------------------------------------------------------

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time");

const offerSchema = z
  .object({
    id: uuid.nullish(),
    title: z.string().trim().min(2, "Give the offer a name").max(120),
    titleUr: optText(120),
    description: optText(500),
    menuItemId: uuid,
    branchId: uuid.nullable(),
    startDate: ymd,
    endDate: ymd.nullish(),
    daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7),
    allDay: z.boolean(),
    startTime: hhmm.nullish(),
    endTime: hhmm.nullish(),
    isActive: z.boolean(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: "End date is before the start date", path: ["endDate"] })
  .refine((v) => v.allDay || (v.startTime && v.endTime && v.startTime !== v.endTime), {
    message: "Pick a start and end time (or choose all day)",
    path: ["endTime"],
  });

export async function saveOfferAction(input: z.input<typeof offerSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requirePermission("bot.manage");
    const parsed = offerSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    const db = await createClient();

    const { data: item } = await db
      .from("menu_items")
      .select("id")
      .eq("id", v.menuItemId)
      .eq("restaurant_id", ctx.restaurant.id)
      .is("archived_at", null)
      .maybeSingle();
    if (!item) return { ok: false, error: "Choose a menu item for this offer.", fieldErrors: { menuItemId: "Choose a menu item" } };

    const tz = ctx.restaurant.timezone;
    const nextDay = (d: string) => {
      const t = new Date(`${d}T12:00:00Z`);
      t.setUTCDate(t.getUTCDate() + 1);
      return t.toISOString().slice(0, 10);
    };
    const days = [...new Set(v.daysOfWeek)].sort();
    const row = {
      branch_id: checkBranch(ctx, v.branchId),
      title: v.title,
      title_ur: v.titleUr,
      description: v.description,
      menu_item_id: v.menuItemId,
      starts_at: startOfLocalDay(v.startDate, tz).toISOString(),
      ends_at: v.endDate ? startOfLocalDay(nextDay(v.endDate), tz).toISOString() : null,
      days_of_week: days.length === 0 || days.length === 7 ? null : days,
      start_time: v.allDay ? null : v.startTime!,
      end_time: v.allDay ? null : v.endTime!,
      is_active: v.isActive,
    };

    let id = v.id ?? null;
    if (id) {
      const { error } = await db.from("offers").update(row).eq("id", id).eq("restaurant_id", ctx.restaurant.id);
      if (error) throw error;
    } else {
      const { count } = await db.from("offers").select("id", { count: "exact", head: true }).eq("restaurant_id", ctx.restaurant.id);
      const { data, error } = await db
        .from("offers")
        .insert({ ...row, restaurant_id: ctx.restaurant.id, sort_order: count ?? 0 })
        .select("id")
        .single();
      if (error) throw error;
      id = data.id;
    }
    await audit(ctx, db, "offer", id, { title: v.title, menu_item_id: v.menuItemId, active: v.isActive });
    revalidate(ctx.restaurant.id);
    return { ok: true, data: { id }, message: "Offer saved" };
  } catch (err) {
    return friendly(err, "Couldn't save the offer. Please try again.");
  }
}

export async function setOfferActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("bot.manage");
    if (!uuid.safeParse(id).success) return { ok: false, error: "Unknown offer." };
    const db = await createClient();
    const { error } = await db.from("offers").update({ is_active: isActive }).eq("id", id).eq("restaurant_id", ctx.restaurant.id);
    if (error) throw error;
    await audit(ctx, db, "offer", id, { active: isActive });
    revalidate(ctx.restaurant.id);
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't change the offer.");
  }
}

/** Offers are not referenced by orders (the order has the item + snapshot), so they can be deleted. */
export async function deleteOfferAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("bot.manage");
    if (!uuid.safeParse(id).success) return { ok: false, error: "Unknown offer." };
    const db = await createClient();
    const { error } = await db.from("offers").delete().eq("id", id).eq("restaurant_id", ctx.restaurant.id);
    if (error) throw error;
    await audit(ctx, db, "offer", id, { deleted: true });
    revalidate(ctx.restaurant.id);
    return { ok: true, message: "Offer deleted" };
  } catch (err) {
    return failure(err, "Couldn't delete the offer.");
  }
}

export async function reorderOffersAction(ids: string[]) {
  return reorder("offers", ids);
}

// ---------------------------------------------------------------------------
// FAQs
// ---------------------------------------------------------------------------

const faqSchema = z.object({
  id: uuid.nullish(),
  question: z.string().trim().min(2, "Write the question").max(200),
  answer: z.string().trim().max(1000),
  answerUr: optText(1000),
  keywords: z.array(z.string().trim().min(1).max(40)).max(30),
  isActive: z.boolean(),
});

export async function saveFaqAction(input: z.input<typeof faqSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requirePermission("bot.manage");
    const parsed = faqSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    if (v.isActive && !v.answer) return { ok: false, error: "Write an answer, or switch this question off.", fieldErrors: { answer: "Write an answer" } };
    const db = await createClient();
    const row = { question: v.question, answer: v.answer, answer_ur: v.answerUr, keywords: [...new Set(v.keywords)], is_active: v.isActive };
    let id = v.id ?? null;
    if (id) {
      const { error } = await db.from("restaurant_faqs").update(row).eq("id", id).eq("restaurant_id", ctx.restaurant.id);
      if (error) throw error;
    } else {
      const { count } = await db.from("restaurant_faqs").select("id", { count: "exact", head: true }).eq("restaurant_id", ctx.restaurant.id);
      const { data, error } = await db
        .from("restaurant_faqs")
        .insert({ ...row, restaurant_id: ctx.restaurant.id, sort_order: count ?? 0 })
        .select("id")
        .single();
      if (error) throw error;
      id = data.id;
    }
    revalidate(ctx.restaurant.id);
    return { ok: true, data: { id }, message: "Saved" };
  } catch (err) {
    return failure(err, "Couldn't save the question.");
  }
}

export async function deleteFaqAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("bot.manage");
    if (!uuid.safeParse(id).success) return { ok: false, error: "Unknown question." };
    const db = await createClient();
    const { error } = await db.from("restaurant_faqs").delete().eq("id", id).eq("restaurant_id", ctx.restaurant.id);
    if (error) throw error;
    revalidate(ctx.restaurant.id);
    return { ok: true, message: "Deleted" };
  } catch (err) {
    return failure(err, "Couldn't delete the question.");
  }
}

export async function reorderFaqsAction(ids: string[]) {
  return reorder("restaurant_faqs", ids);
}

/** Adds the common questions (blank answers, switched off until answered). Skips ones already there. */
export async function addFaqSuggestionsAction(): Promise<ActionResult<{ added: number }>> {
  try {
    const ctx = await requirePermission("bot.manage");
    const db = await createClient();
    const { data: existing, error: e1 } = await db.from("restaurant_faqs").select("question").eq("restaurant_id", ctx.restaurant.id);
    if (e1) throw e1;
    const have = new Set((existing ?? []).map((f) => f.question.toLowerCase()));
    const rows = FAQ_SUGGESTIONS.filter((s) => !have.has(s.question.toLowerCase())).map((s, i) => ({
      restaurant_id: ctx.restaurant.id,
      question: s.question,
      answer: "",
      keywords: s.keywords,
      is_active: false,
      sort_order: (existing?.length ?? 0) + i,
    }));
    if (rows.length) {
      const { error } = await db.from("restaurant_faqs").insert(rows);
      if (error) throw error;
    }
    revalidate(ctx.restaurant.id);
    return { ok: true, data: { added: rows.length }, message: rows.length ? `Added ${rows.length} questions — write the answers` : "Already added" };
  } catch (err) {
    return failure(err, "Couldn't add the questions.");
  }
}

// ---------------------------------------------------------------------------
// Restaurant info
// ---------------------------------------------------------------------------

const branchInfoSchema = z
  .object({
    branchId: uuid,
    address: optText(300),
    area: optText(80),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    googleMapsUrl: optText(500).refine((v) => !v || /^https:\/\//i.test(v), "Paste a link that starts with https://"),
    deliveryMinutes: z.number().int().min(0, "Can't be negative").max(600, "Too long"),
  })
  .refine((v) => (v.latitude === null) === (v.longitude === null), { message: "Location is incomplete", path: ["latitude"] });

/** Owner/manager of that branch: address, pin, Maps link, delivery time. */
export async function saveBranchInfoAction(input: z.input<typeof branchInfoSchema>): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("bot.manage");
    const parsed = branchInfoSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    checkBranch(ctx, v.branchId);
    const db = await createClient();
    const { error } = await db
      .from("branches")
      .update({
        address: v.address,
        area: v.area,
        latitude: v.latitude,
        longitude: v.longitude,
        google_maps_url: v.googleMapsUrl,
        delivery_minutes: v.deliveryMinutes,
      })
      .eq("id", v.branchId)
      .eq("restaurant_id", ctx.restaurant.id);
    if (error) throw error;
    await writeAuditLog(db, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "branch.updated",
      entityType: "branch",
      entityId: v.branchId,
      newData: { address: v.address, area: v.area, latitude: v.latitude, longitude: v.longitude, delivery_minutes: v.deliveryMinutes },
    });
    revalidate(ctx.restaurant.id);
    revalidatePath("/settings/branches");
    return { ok: true, message: "Branch info saved" };
  } catch (err) {
    return friendly(err, "Couldn't save the branch info.");
  }
}

const restaurantInfoSchema = z.object({
  dineInAvailable: z.boolean(),
  paymentMethods: z.array(z.enum(["cod", "card_on_delivery"])).min(1, "Choose at least one way to pay"),
  mentionOfferOnGreeting: z.boolean(),
});

/** Owner only (restaurants RLS): dine-in, payment methods, greeting offer. */
export async function saveRestaurantBotInfoAction(input: z.input<typeof restaurantInfoSchema>): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("settings.edit");
    const parsed = restaurantInfoSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    const db = await createClient();
    const row = {
      dine_in_available: v.dineInAvailable,
      payment_methods: [...new Set(v.paymentMethods)],
      mention_offer_on_greeting: v.mentionOfferOnGreeting,
    };
    const { error } = await db.from("restaurants").update(row).eq("id", ctx.restaurant.id);
    if (error) throw error;
    await writeAuditLog(db, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "bot.settings_changed",
      entityType: "restaurant",
      entityId: ctx.restaurant.id,
      newData: row,
    });
    revalidate(ctx.restaurant.id);
    return { ok: true, message: "Saved" };
  } catch (err) {
    return failure(err, "Couldn't save. Please try again.");
  }
}

const GOOGLE_HOSTS = /(^|\.)(google\.[a-z.]+|goo\.gl|googleusercontent\.com)$/i;

/**
 * Pasted Google Maps link → coordinates. Short links (maps.app.goo.gl) are
 * expanded by following redirects, but ONLY to Google hosts (no SSRF).
 */
export async function resolveMapsLinkAction(url: string): Promise<ActionResult<{ latitude: number; longitude: number; url: string }>> {
  try {
    await requirePermission("bot.manage");
    const parsed = z.string().trim().url().max(500).safeParse(url);
    if (!parsed.success) return { ok: false, error: "Paste the full Google Maps link." };
    let current = parsed.data;
    const direct = coordinatesFromMapsUrl(current);
    if (direct) return { ok: true, data: { ...direct, url: current } };
    if (!isShortMapsLink(current)) return { ok: false, error: "Couldn't find a location in this link. In Google Maps tap Share → Copy link." };

    for (let hop = 0; hop < 4; hop++) {
      const host = new URL(current).hostname;
      if (!GOOGLE_HOSTS.test(host)) break;
      const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      const next = res.headers.get("location");
      if (!next) {
        // Some pages put the full link in the HTML instead of a redirect.
        const body = res.ok ? (await res.text()).slice(0, 200_000) : "";
        const found = coordinatesFromMapsUrl(body);
        if (found) return { ok: true, data: { ...found, url: parsed.data } };
        break;
      }
      current = new URL(next, current).toString();
      const coords = coordinatesFromMapsUrl(current);
      if (coords) return { ok: true, data: { ...coords, url: parsed.data } };
    }
    return { ok: false, error: "Couldn't read the location from this link. Use “Use my current location” instead, at the restaurant." };
  } catch (err) {
    return failure(err, "Couldn't open this link. Please try again.");
  }
}

