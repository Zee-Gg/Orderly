"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { writeAuditLog } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { publicEnv } from "@/lib/env";
import { formatPKR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import {
  bulkPriceSchema,
  categorySchema,
  groupSchema,
  itemSchema,
  type BulkPriceInput,
  type CategoryInput,
  type GroupInput,
  type ItemInput,
} from "@/lib/validation/menu";
import { computeBulkPrices } from "./bulk-price";
import { MENU_IMAGE_BUCKET } from "./image-constants";
import { revalidatePublicMenu } from "./public-cache";
import { getPriceRows } from "./queries";

const idSchema = z.uuid();

function revalidateMenu(restaurantId: string) {
  revalidatePath("/menu", "layout");
  revalidatePublicMenu(restaurantId);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function saveCategory(input: CategoryInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requirePermission("menu.edit");
    const parsed = categorySchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();

    if (v.id) {
      const { data, error } = await supabase
        .from("menu_categories")
        .update({ name: v.name, name_ur: v.nameUr || null, is_active: v.isActive })
        .eq("id", v.id)
        .eq("restaurant_id", ctx.restaurant.id)
        .is("archived_at", null)
        .select("id")
        .single();
      if (error) throw error;
      await writeAuditLog(supabase, {
        restaurantId: ctx.restaurant.id,
        userId: ctx.user.id,
        action: "menu_category.updated",
        entityType: "menu_category",
        entityId: data.id,
        newData: { name: v.name, is_active: v.isActive },
      });
      revalidateMenu(ctx.restaurant.id);
      return { ok: true, data: { id: data.id } };
    }

    const { data: last } = await supabase
      .from("menu_categories")
      .select("sort_order")
      .eq("restaurant_id", ctx.restaurant.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data, error } = await supabase
      .from("menu_categories")
      .insert({
        restaurant_id: ctx.restaurant.id,
        name: v.name,
        name_ur: v.nameUr || null,
        is_active: v.isActive,
        sort_order: (last?.sort_order ?? -1) + 1,
      })
      .select("id")
      .single();
    if (error) throw error;
    await writeAuditLog(supabase, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "menu_category.created",
      entityType: "menu_category",
      entityId: data.id,
      newData: { name: v.name },
    });
    revalidateMenu(ctx.restaurant.id);
    return { ok: true, data: { id: data.id } };
  } catch (err) {
    return failure(err, "Couldn't save the category. Please try again.");
  }
}

/** Soft delete. Items inside stay saved but disappear from the menu. */
export async function archiveCategory(categoryId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("menu.edit");
    const id = idSchema.parse(categoryId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("menu_categories")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("restaurant_id", ctx.restaurant.id)
      .is("archived_at", null)
      .select("id, name")
      .single();
    if (error) throw error;
    await writeAuditLog(supabase, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "menu_category.archived",
      entityType: "menu_category",
      entityId: data.id,
      oldData: { name: data.name },
    });
    revalidateMenu(ctx.restaurant.id);
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't remove the category. Please try again.");
  }
}

export async function reorderCategories(ids: string[]): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("menu.edit");
    const parsed = z.array(z.uuid()).max(200).parse(ids);
    const supabase = await createClient();
    const { error } = await supabase.rpc("reorder_menu_categories", {
      p_restaurant_id: ctx.restaurant.id,
      p_ids: parsed,
    });
    if (error) throw error;
    revalidateMenu(ctx.restaurant.id);
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't save the new order.");
  }
}

export async function reorderItems(categoryId: string, ids: string[]): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("menu.edit");
    const cat = idSchema.parse(categoryId);
    const parsed = z.array(z.uuid()).max(500).parse(ids);
    const supabase = await createClient();
    const { error } = await supabase.rpc("reorder_menu_items", { p_category_id: cat, p_ids: parsed });
    if (error) throw error;
    revalidateMenu(ctx.restaurant.id);
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't save the new order.");
  }
}

// ---------------------------------------------------------------------------
// Stock (owner, manager, staff, kitchen) — via set_item_stock RPC, which
// checks branch access and writes the audit entry itself.
// ---------------------------------------------------------------------------

export async function setItemStock(itemId: string, isAvailable: boolean): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("menu.stock");
    if (!ctx.currentBranch) {
      return { ok: false, error: "Choose a branch first (top of the sidebar) to change stock." };
    }
    const id = idSchema.parse(itemId);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_item_stock", {
      p_branch_id: ctx.currentBranch.id,
      p_item_id: id,
      p_is_available: z.boolean().parse(isAvailable),
    });
    if (error) throw error;
    revalidateMenu(ctx.restaurant.id);
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't change stock. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function validImageUrl(url: string, restaurantId: string) {
  if (!url) return true;
  return url.startsWith(
    `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${MENU_IMAGE_BUCKET}/${restaurantId}/`,
  );
}

type PriceMap = Record<string, number | null>;

/** Readable price snapshot, e.g. { "Large": 185000, "DHA Branch · Large": 199000 }. */
function priceMap(
  hasSizes: boolean,
  basePrice: number | null,
  sizes: { key: string; name: string; price: number }[],
  branches: { branchId: string; priceOverride: number | null; sizePrices: { sizeKey: string; price: number }[] }[],
  branchNames: Map<string, string>,
): PriceMap {
  const map: PriceMap = {};
  if (!hasSizes) map["Price"] = basePrice;
  for (const s of hasSizes ? sizes : []) map[s.name] = s.price;
  for (const b of branches) {
    const bn = branchNames.get(b.branchId) ?? "Branch";
    if (!hasSizes && b.priceOverride !== null) map[bn] = b.priceOverride;
    for (const sp of hasSizes ? b.sizePrices : []) {
      const size = sizes.find((s) => s.key === sp.sizeKey);
      if (size) map[`${bn} · ${size.name}`] = sp.price;
    }
  }
  return map;
}

export async function saveItem(input: ItemInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requirePermission("menu.edit");
    const parsed = itemSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    if (!validImageUrl(v.imageUrl, ctx.restaurant.id)) {
      return { ok: false, error: "Please upload the photo again.", fieldErrors: { imageUrl: "Upload the photo again" } };
    }

    const supabase = await createClient();
    const { data: branchRows } = await supabase
      .from("branches")
      .select("id, name")
      .eq("restaurant_id", ctx.restaurant.id);
    const branchNames = new Map((branchRows ?? []).map((b) => [b.id, b.name]));
    if (v.branches.some((b) => !branchNames.has(b.branchId))) {
      return { ok: false, error: "One of the branches isn't available." };
    }

    // Old prices, for the audit log.
    let oldPrices: PriceMap | null = null;
    if (v.id) {
      const { data: old } = await supabase
        .from("menu_items")
        .select(
          "base_price, sizes:item_variants(id, name, price, is_active, archived_at), settings:branch_item_settings(branch_id, price_override)",
        )
        .eq("id", v.id)
        .eq("restaurant_id", ctx.restaurant.id)
        .single();
      if (!old) return { ok: false, error: "This item no longer exists." };
      const liveSizes = old.sizes.filter((s) => s.is_active && !s.archived_at);
      const { data: oldBvp } = liveSizes.length
        ? await supabase
            .from("branch_variant_prices")
            .select("branch_id, variant_id, price")
            .in("variant_id", liveSizes.map((s) => s.id))
        : { data: [] };
      oldPrices = priceMap(
        liveSizes.length > 0,
        old.base_price,
        liveSizes.map((s) => ({ key: s.id, name: s.name, price: s.price })),
        old.settings.map((s) => ({
          branchId: s.branch_id,
          priceOverride: s.price_override,
          sizePrices: (oldBvp ?? [])
            .filter((p) => p.branch_id === s.branch_id)
            .map((p) => ({ sizeKey: p.variant_id, price: p.price })),
        })),
        branchNames,
      );
    }

    const sizes = v.hasSizes ? v.sizes : [];
    const newPrices = priceMap(v.hasSizes, v.hasSizes ? null : v.basePrice, sizes, v.branches, branchNames);
    const changedKeys = oldPrices
      ? [...new Set([...Object.keys(oldPrices), ...Object.keys(newPrices)])].filter(
          (k) => (oldPrices![k] ?? null) !== (newPrices[k] ?? null),
        )
      : [];
    if (changedKeys.length && !can(ctx.role, "prices.edit")) {
      return { ok: false, error: "You don't have permission to change prices." };
    }

    const { data: itemId, error } = await supabase.rpc("save_menu_item", {
      p_restaurant_id: ctx.restaurant.id,
      p_item: {
        id: v.id ?? null,
        category_id: v.categoryId,
        name: v.name,
        name_ur: v.nameUr,
        description: v.description,
        description_ur: v.descriptionUr,
        image_url: v.imageUrl,
        base_price: v.hasSizes ? null : v.basePrice,
        is_active: v.isActive,
        tags: v.tags,
        prep_time_minutes: v.prepTimeMinutes,
        aliases: v.aliases,
        removable_options: v.removableOptions,
        sizes: sizes.map((s) => ({
          id: s.id ?? null,
          key: s.key,
          name: s.name,
          name_ur: s.nameUr,
          price: s.price,
          is_default: s.isDefault,
        })),
        group_ids: v.groupIds,
        branches: v.branches.map((b) => ({
          branch_id: b.branchId,
          is_hidden: b.isHidden,
          is_available: b.isAvailable,
          price_override: v.hasSizes ? null : b.priceOverride,
          size_prices: v.hasSizes ? b.sizePrices.map((p) => ({ size_key: p.sizeKey, price: p.price })) : [],
        })),
      } satisfies Json,
    });
    if (error) {
      if (error.code === "P0002") return { ok: false, error: "This item was changed or removed. Please reload." };
      throw error;
    }

    const base = {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      entityType: "menu_item",
      entityId: itemId,
    };
    if (!v.id) {
      await writeAuditLog(supabase, { ...base, action: "menu_item.created", newData: { name: v.name, prices: newPrices } });
    } else if (changedKeys.length) {
      await writeAuditLog(supabase, {
        ...base,
        action: "menu_item.price_changed",
        oldData: { name: v.name, prices: Object.fromEntries(changedKeys.map((k) => [k, oldPrices![k] ?? null])) },
        newData: { name: v.name, prices: Object.fromEntries(changedKeys.map((k) => [k, newPrices[k] ?? null])) },
      });
    }

    revalidateMenu(ctx.restaurant.id);
    return { ok: true, data: { id: itemId } };
  } catch (err) {
    return failure(err, "Couldn't save the item. Please try again.");
  }
}

/** Soft delete: hidden everywhere, kept for past orders and reports. */
export async function archiveItem(itemId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("menu.edit");
    const id = idSchema.parse(itemId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("menu_items")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("restaurant_id", ctx.restaurant.id)
      .is("archived_at", null)
      .select("id, name")
      .single();
    if (error) throw error;
    await writeAuditLog(supabase, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "menu_item.archived",
      entityType: "menu_item",
      entityId: data.id,
      oldData: { name: data.name },
    });
    revalidateMenu(ctx.restaurant.id);
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't remove the item. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Extras / Choices groups
// ---------------------------------------------------------------------------

export async function saveGroup(input: GroupInput): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requirePermission("menu.edit");
    const parsed = groupSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    const supabase = await createClient();

    // Option price changes are price changes: audit them.
    let changed: { name: string; old: number; new: number }[] = [];
    if (v.id) {
      const { data: old } = await supabase
        .from("modifier_options")
        .select("id, name, price_delta")
        .eq("group_id", v.id)
        .is("archived_at", null);
      changed = v.options
        .map((o) => {
          const before = old?.find((x) => x.id === o.id);
          return before && before.price_delta !== o.priceDelta
            ? { name: o.name, old: before.price_delta, new: o.priceDelta }
            : null;
        })
        .filter((c): c is { name: string; old: number; new: number } => c !== null);
      if (changed.length && !can(ctx.role, "prices.edit")) {
        return { ok: false, error: "You don't have permission to change prices." };
      }
    }

    const { data: groupId, error } = await supabase.rpc("save_modifier_group", {
      p_restaurant_id: ctx.restaurant.id,
      p_group: {
        id: v.id ?? null,
        name: v.name,
        name_ur: v.nameUr,
        min_select: v.minSelect,
        max_select: v.maxSelect,
        options: v.options.map((o) => ({
          id: o.id ?? null,
          name: o.name,
          name_ur: o.nameUr,
          price_delta: o.priceDelta,
          is_default: o.isDefault,
          is_available: o.isAvailable,
        })),
      } satisfies Json,
    });
    if (error) {
      if (error.code === "P0002") return { ok: false, error: "This group was changed or removed. Please reload." };
      throw error;
    }

    if (changed.length) {
      await writeAuditLog(supabase, {
        restaurantId: ctx.restaurant.id,
        userId: ctx.user.id,
        action: "modifier_option.price_changed",
        entityType: "modifier_group",
        entityId: groupId,
        oldData: { group: v.name, prices: Object.fromEntries(changed.map((c) => [c.name, c.old])) },
        newData: { group: v.name, prices: Object.fromEntries(changed.map((c) => [c.name, c.new])) },
      });
    }
    revalidateMenu(ctx.restaurant.id);
    return { ok: true, data: { id: groupId } };
  } catch (err) {
    return failure(err, "Couldn't save. Please try again.");
  }
}

export async function archiveGroup(groupId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("menu.edit");
    const id = idSchema.parse(groupId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("modifier_groups")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("restaurant_id", ctx.restaurant.id)
      .is("archived_at", null)
      .select("id, name")
      .single();
    if (error) throw error;
    await writeAuditLog(supabase, {
      restaurantId: ctx.restaurant.id,
      userId: ctx.user.id,
      action: "modifier_group.archived",
      entityType: "modifier_group",
      entityId: data.id,
      oldData: { name: data.name },
    });
    revalidateMenu(ctx.restaurant.id);
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't remove the group. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Bulk price update
// ---------------------------------------------------------------------------

export async function applyBulkPriceUpdate(input: BulkPriceInput): Promise<ActionResult<{ count: number }>> {
  try {
    const ctx = await requirePermission("prices.edit");
    const parsed = bulkPriceSchema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const v = parsed.data;
    if (v.mode === "percent" && v.amount > 100 && v.direction === "decrease") {
      return { ok: false, error: "You can't decrease by more than 100%." };
    }

    // Recompute from fresh database prices — never trust the preview's numbers.
    const rows = await getPriceRows(ctx.restaurant.id, v.categoryId);
    const result = computeBulkPrices(rows, v);
    if (result.belowZero.length) {
      return { ok: false, error: `${result.belowZero.length} price(s) would go below Rs 0. Use a smaller amount.` };
    }
    if (result.changes.length === 0) return { ok: false, error: "No prices would change." };

    const describe = (c: (typeof result.changes)[number]) => (c.label ? `${c.itemName} · ${c.label}` : c.itemName);
    const supabase = await createClient();
    const { data: count, error } = await supabase.rpc("apply_price_changes", {
      p_restaurant_id: ctx.restaurant.id,
      p_changes: result.changes.map((c) => ({
        kind: c.kind,
        id: c.id,
        branch_id: c.branchId ?? null,
        price: c.newPrice,
      })),
      p_audit: {
        old: {
          rule: `${v.direction} ${v.mode === "percent" ? `${v.amount}%` : formatPKR(v.amount)}, round to ${formatPKR(v.rounding)}`,
          category_id: v.categoryId,
          prices: Object.fromEntries(result.changes.map((c) => [describe(c), c.price])),
        },
        new: { prices: Object.fromEntries(result.changes.map((c) => [describe(c), c.newPrice])) },
      },
    });
    if (error) throw error;
    revalidateMenu(ctx.restaurant.id);
    return { ok: true, data: { count } };
  } catch (err) {
    return failure(err, "Couldn't update prices. Nothing was changed.");
  }
}
