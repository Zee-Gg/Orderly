import "server-only";
import type { CurrentContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { PriceRow } from "./bulk-price";

/**
 * Read models for the menu editor screens (staff only, RLS applies).
 * Prices shown here are for display; anything that charges money goes
 * through src/lib/menu/pricing.ts.
 */

export type BoardCategory = {
  id: string;
  name: string;
  nameUr: string | null;
  isActive: boolean;
};

export type BoardItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
  aliases: string[];
  /** Price for the current branch (or the normal price for "All branches"). */
  price: number | null;
  hasSizes: boolean;
  extrasCount: number;
  removableCount: number;
  /** Stock / hidden at the current branch (null when "All branches"). */
  inStock: boolean | null;
  hiddenHere: boolean;
};

export async function getMenuBoard(ctx: CurrentContext) {
  const supabase = await createClient();
  const branchId = ctx.currentBranch?.id ?? null;

  const [cats, items] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("id, name, name_ur, is_active")
      .eq("restaurant_id", ctx.restaurant.id)
      .is("archived_at", null)
      .order("sort_order")
      .order("name"),
    supabase
      .from("menu_items")
      .select(
        "id, category_id, name, description, image_url, base_price, is_active, aliases, removable_options, sizes:item_variants(id, price, is_active, archived_at), links:item_modifier_groups(group:modifier_groups(archived_at))",
      )
      .eq("restaurant_id", ctx.restaurant.id)
      .is("archived_at", null)
      .order("sort_order")
      .order("name"),
  ]);
  if (cats.error) throw cats.error;
  if (items.error) throw items.error;

  const settings = new Map<string, { is_available: boolean; is_hidden: boolean; price_override: number | null }>();
  const sizePrices = new Map<string, number>();
  if (branchId) {
    const [s, p] = await Promise.all([
      supabase
        .from("branch_item_settings")
        .select("item_id, is_available, is_hidden, price_override")
        .eq("branch_id", branchId),
      supabase.from("branch_variant_prices").select("variant_id, price").eq("branch_id", branchId),
    ]);
    for (const row of s.data ?? []) settings.set(row.item_id, row);
    for (const row of p.data ?? []) sizePrices.set(row.variant_id, row.price);
  }

  const boardItems: BoardItem[] = (items.data ?? []).map((i) => {
    const liveSizes = i.sizes.filter((s) => s.is_active && !s.archived_at);
    const s = settings.get(i.id);
    const price = liveSizes.length
      ? Math.min(...liveSizes.map((v) => sizePrices.get(v.id) ?? v.price))
      : (s?.price_override ?? i.base_price);
    return {
      id: i.id,
      categoryId: i.category_id,
      name: i.name,
      description: i.description,
      imageUrl: i.image_url,
      isActive: i.is_active,
      aliases: i.aliases,
      price,
      hasSizes: liveSizes.length > 0,
      extrasCount: i.links.filter((l) => l.group && !l.group.archived_at).length,
      removableCount: i.removable_options.length,
      inStock: branchId ? (s?.is_available ?? true) : null,
      hiddenHere: branchId ? (s?.is_hidden ?? false) : false,
    };
  });

  const categories: BoardCategory[] = (cats.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    nameUr: c.name_ur,
    isActive: c.is_active,
  }));
  return { categories, items: boardItems };
}

export type LibraryGroup = {
  id: string;
  name: string;
  nameUr: string | null;
  minSelect: number;
  maxSelect: number;
  options: {
    id: string;
    name: string;
    nameUr: string | null;
    priceDelta: number;
    isDefault: boolean;
    isAvailable: boolean;
  }[];
  usedBy: { id: string; name: string }[];
};

/** Reusable Extras/Choices groups with their options and the items using them. */
export async function getGroupLibrary(restaurantId: string): Promise<LibraryGroup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("modifier_groups")
    .select(
      "id, name, name_ur, min_select, max_select, options:modifier_options(id, name, name_ur, price_delta, is_default, is_available, sort_order, archived_at), links:item_modifier_groups(item:menu_items(id, name, archived_at))",
    )
    .eq("restaurant_id", restaurantId)
    .is("archived_at", null)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    nameUr: g.name_ur,
    minSelect: g.min_select,
    maxSelect: g.max_select,
    options: g.options
      .filter((o) => !o.archived_at)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((o) => ({
        id: o.id,
        name: o.name,
        nameUr: o.name_ur,
        priceDelta: o.price_delta,
        isDefault: o.is_default,
        isAvailable: o.is_available,
      })),
    usedBy: g.links
      .map((l) => l.item)
      .filter((i): i is { id: string; name: string; archived_at: string | null } => !!i && !i.archived_at)
      .map((i) => ({ id: i.id, name: i.name })),
  }));
}

export type EditorItem = {
  id: string;
  categoryId: string;
  name: string;
  nameUr: string;
  description: string;
  descriptionUr: string;
  imageUrl: string;
  basePrice: number | null;
  isActive: boolean;
  tags: string[];
  prepTimeMinutes: number | null;
  aliases: string[];
  removableOptions: string[];
  sizes: { id: string; name: string; nameUr: string; price: number; isDefault: boolean }[];
  groupIds: string[];
  branches: {
    branchId: string;
    isHidden: boolean;
    isAvailable: boolean;
    priceOverride: number | null;
    sizePrices: Record<string, number>;
  }[];
};

/** Everything the item editor needs: the item (if editing), categories, groups, branches. */
export async function getItemEditorData(ctx: CurrentContext, itemId: string | null) {
  const supabase = await createClient();
  const [cats, groups, branches] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("id, name")
      .eq("restaurant_id", ctx.restaurant.id)
      .is("archived_at", null)
      .order("sort_order"),
    getGroupLibrary(ctx.restaurant.id),
    supabase
      .from("branches")
      .select("id, name, is_active")
      .eq("restaurant_id", ctx.restaurant.id)
      .eq("is_active", true)
      .order("created_at"),
  ]);
  if (cats.error) throw cats.error;
  if (branches.error) throw branches.error;

  let item: EditorItem | null = null;
  if (itemId) {
    const { data, error } = await supabase
      .from("menu_items")
      .select(
        "id, category_id, name, name_ur, description, description_ur, image_url, base_price, is_active, tags, prep_time_minutes, aliases, removable_options, sizes:item_variants(id, name, name_ur, price, is_default, sort_order, is_active, archived_at), links:item_modifier_groups(group_id, sort_order), settings:branch_item_settings(branch_id, is_hidden, is_available, price_override)",
      )
      .eq("id", itemId)
      .eq("restaurant_id", ctx.restaurant.id)
      .is("archived_at", null)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const sizes = data.sizes
        .filter((s) => s.is_active && !s.archived_at)
        .sort((a, b) => a.sort_order - b.sort_order);
      const { data: bvp } = sizes.length
        ? await supabase
            .from("branch_variant_prices")
            .select("branch_id, variant_id, price")
            .in("variant_id", sizes.map((s) => s.id))
        : { data: [] };
      item = {
        id: data.id,
        categoryId: data.category_id,
        name: data.name,
        nameUr: data.name_ur ?? "",
        description: data.description ?? "",
        descriptionUr: data.description_ur ?? "",
        imageUrl: data.image_url ?? "",
        basePrice: data.base_price,
        isActive: data.is_active,
        tags: data.tags,
        prepTimeMinutes: data.prep_time_minutes,
        aliases: data.aliases,
        removableOptions: data.removable_options,
        sizes: sizes.map((s) => ({
          id: s.id,
          name: s.name,
          nameUr: s.name_ur ?? "",
          price: s.price,
          isDefault: s.is_default,
        })),
        groupIds: [...data.links].sort((a, b) => a.sort_order - b.sort_order).map((l) => l.group_id),
        branches: data.settings.map((s) => ({
          branchId: s.branch_id,
          isHidden: s.is_hidden,
          isAvailable: s.is_available,
          priceOverride: s.price_override,
          sizePrices: Object.fromEntries(
            (bvp ?? []).filter((p) => p.branch_id === s.branch_id).map((p) => [p.variant_id, p.price]),
          ),
        })),
      };
    }
  }

  return {
    item,
    categories: (cats.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    groups,
    branches: (branches.data ?? []).map((b) => ({ id: b.id, name: b.name })),
  };
}

/** Every editable price in scope, for the bulk price tool. */
export async function getPriceRows(restaurantId: string, categoryId: string | null): Promise<PriceRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("menu_items")
    .select(
      "id, name, category_id, base_price, sizes:item_variants(id, name, price, is_active, archived_at, sort_order), settings:branch_item_settings(branch_id, price_override, branch:branches(name))",
    )
    .eq("restaurant_id", restaurantId)
    .is("archived_at", null)
    .order("sort_order");
  if (categoryId) query = query.eq("category_id", categoryId);
  const { data, error } = await query;
  if (error) throw error;

  const items = data ?? [];
  const sizeIds = items.flatMap((i) => i.sizes.filter((s) => s.is_active && !s.archived_at).map((s) => s.id));
  const { data: bvp, error: bvpError } = sizeIds.length
    ? await supabase
        .from("branch_variant_prices")
        .select("variant_id, branch_id, price, branch:branches(name)")
        .in("variant_id", sizeIds)
    : { data: [], error: null };
  if (bvpError) throw bvpError;

  const rows: PriceRow[] = [];
  for (const i of items) {
    const base = { itemId: i.id, itemName: i.name, categoryId: i.category_id };
    const sizes = i.sizes.filter((s) => s.is_active && !s.archived_at).sort((a, b) => a.sort_order - b.sort_order);
    if (sizes.length === 0) {
      if (i.base_price !== null) rows.push({ ...base, kind: "item", id: i.id, label: "", price: i.base_price });
      for (const s of i.settings) {
        if (s.price_override !== null) {
          rows.push({
            ...base,
            kind: "item_branch",
            id: i.id,
            branchId: s.branch_id,
            label: s.branch?.name ?? "Branch",
            price: s.price_override,
          });
        }
      }
    }
    for (const size of sizes) {
      rows.push({ ...base, kind: "size", id: size.id, label: size.name, price: size.price });
      for (const p of (bvp ?? []).filter((x) => x.variant_id === size.id)) {
        rows.push({
          ...base,
          kind: "size_branch",
          id: size.id,
          branchId: p.branch_id,
          label: `${p.branch?.name ?? "Branch"} · ${size.name}`,
          price: p.price,
        });
      }
    }
  }
  return rows;
}
