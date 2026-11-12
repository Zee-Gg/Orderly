/**
 * THE pricing engine. Every price in Orderly — staff orders (Phase 4), the
 * WhatsApp bot (Phase 7), the customer menu (Phase 8) — is calculated here.
 *
 * Rules:
 *  - Prices are ALWAYS loaded from the database. Never trust a price sent by
 *    the browser, a staff member or the AI.
 *  - All money is integer paisa.
 *  - Errors have stable codes + simple English messages, so the bot can turn
 *    them into follow-up questions ("Which size would you like?").
 *
 * Structure: pure functions (priceCartItem, buildBranchMenu) that take plain
 * data — unit-tested in pricing.test.ts — plus loaders (resolveCartItem,
 * getBranchMenu) that fetch that data with the Supabase client you pass in:
 * the signed-in user's server client (RLS applies) or the admin client for
 * webhooks (scope by restaurantId yourself).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Db = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Data shapes (what the loaders produce, what the pure functions consume)
// ---------------------------------------------------------------------------

export type PricingOption = {
  id: string;
  name: string;
  nameUr: string | null;
  priceDelta: number;
  isDefault: boolean;
  isAvailable: boolean;
  archived: boolean;
  sortOrder: number;
};

export type PricingGroup = {
  id: string;
  name: string;
  nameUr: string | null;
  minSelect: number;
  maxSelect: number;
  archived: boolean;
  sortOrder: number;
  options: PricingOption[];
};

export type PricingSize = {
  id: string;
  name: string;
  nameUr: string | null;
  price: number;
  isDefault: boolean;
  isActive: boolean;
  archived: boolean;
  sortOrder: number;
};

export type ItemPricingData = {
  item: {
    id: string;
    restaurantId: string;
    name: string;
    nameUr: string | null;
    basePrice: number | null;
    isActive: boolean;
    archived: boolean;
    removableOptions: string[];
  };
  category: { isActive: boolean; archived: boolean };
  sizes: PricingSize[];
  groups: PricingGroup[];
  branch: { id: string; restaurantId: string; isActive: boolean } | null;
  /** branch_item_settings row for (branch, item); null = defaults. */
  branchSettings: { isAvailable: boolean; isHidden: boolean; priceOverride: number | null } | null;
  /** branch_variant_prices for this branch, by size id. */
  branchSizePrices: Record<string, number>;
};

export type CartItemInput = {
  restaurantId: string;
  branchId: string;
  itemId: string;
  variantId?: string | null;
  modifierOptionIds?: string[];
  removals?: string[];
  quantity: number;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PricingErrorCode =
  | "ITEM_NOT_FOUND"
  | "BRANCH_NOT_FOUND"
  | "ITEM_ARCHIVED"
  | "ITEM_UNAVAILABLE"
  | "ITEM_NOT_SOLD_AT_BRANCH"
  | "ITEM_OUT_OF_STOCK"
  | "ITEM_NOT_PRICED"
  | "INVALID_QUANTITY"
  | "SIZE_REQUIRED"
  | "INVALID_SIZE"
  | "INVALID_OPTION"
  | "OPTION_UNAVAILABLE"
  | "DUPLICATE_OPTION"
  | "REQUIRED_GROUP_MISSING"
  | "TOO_FEW_OPTIONS"
  | "TOO_MANY_OPTIONS"
  | "INVALID_REMOVAL";

export type PricingError = {
  code: PricingErrorCode;
  /** Simple English, safe to show to staff or (rephrased) to customers. */
  message: string;
  groupId?: string;
  groupName?: string;
  /** Valid choices the customer could pick instead (sizes, options, removals). */
  choices?: string[];
  min?: number;
  max?: number;
};

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type SelectedOption = {
  id: string;
  groupId: string;
  groupName: string;
  name: string;
  nameUr: string | null;
  priceDelta: number;
};

/**
 * Frozen copy of names and prices at the moment of ordering. Orders store
 * this, so later menu edits never change past orders.
 */
export type CartItemSnapshot = {
  item: { id: string; name: string; name_ur: string | null };
  size: { id: string; name: string; name_ur: string | null; price: number } | null;
  base_price: number;
  options: {
    id: string;
    group_id: string;
    group_name: string;
    name: string;
    name_ur: string | null;
    price_delta: number;
  }[];
  removals: string[];
  unit_price: number;
  quantity: number;
  line_total: number;
  priced_at: string;
};

export type ResolvedCartItem = {
  itemId: string;
  itemName: string;
  itemNameUr: string | null;
  variantId: string | null;
  sizeName: string | null;
  /** Size price or item price for this branch, before extras. */
  basePrice: number;
  options: SelectedOption[];
  removals: string[];
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  snapshot: CartItemSnapshot;
};

export type PricingResult =
  | { ok: true; line: ResolvedCartItem }
  | { ok: false; errors: PricingError[] };

export const MAX_QUANTITY = 99;

// ---------------------------------------------------------------------------
// Effective prices (shared by the cart and the branch menu)
// ---------------------------------------------------------------------------

export function activeSizes(sizes: PricingSize[]) {
  return sizes
    .filter((s) => s.isActive && !s.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function activeGroups(groups: PricingGroup[]) {
  return groups.filter((g) => !g.archived).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function liveOptions(group: PricingGroup) {
  return group.options.filter((o) => !o.archived).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Branch price for a size, falling back to the size's normal price. */
export function effectiveSizePrice(size: PricingSize, branchSizePrices: Record<string, number>) {
  return branchSizePrices[size.id] ?? size.price;
}

/** Branch price for an item without sizes, falling back to base_price. */
export function effectiveBasePrice(
  basePrice: number | null,
  branchSettings: ItemPricingData["branchSettings"],
) {
  return branchSettings?.priceOverride ?? basePrice;
}

function err(code: PricingErrorCode, message: string, extra?: Partial<PricingError>): PricingError {
  return { code, message, ...extra };
}

function list(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** "Choose 1", "Choose up to 3", "Choose 1 to 2" — matches the editor wording. */
export function choiceRule(min: number, max: number) {
  if (min === 0) return max === 1 ? "optional, pick 1" : `optional, pick up to ${max}`;
  if (min === max) return `pick ${min}`;
  return `pick ${min} to ${max}`;
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

/**
 * Validate a cart line and price it. Pure: give it the data, get a result.
 * `now` is injectable for tests.
 */
export function priceCartItem(
  data: ItemPricingData | null,
  input: CartItemInput,
  now: Date = new Date(),
): PricingResult {
  // 1. Item-level checks: stop at the first one, nothing else matters after.
  if (!data || data.item.restaurantId !== input.restaurantId) {
    return { ok: false, errors: [err("ITEM_NOT_FOUND", "We couldn't find this item on the menu.")] };
  }
  const { item } = data;
  if (!data.branch || data.branch.restaurantId !== input.restaurantId || !data.branch.isActive) {
    return { ok: false, errors: [err("BRANCH_NOT_FOUND", "This branch isn't taking orders.")] };
  }
  if (item.archived) {
    return { ok: false, errors: [err("ITEM_ARCHIVED", `${item.name} is no longer on the menu.`)] };
  }
  if (!item.isActive || !data.category.isActive || data.category.archived) {
    return { ok: false, errors: [err("ITEM_UNAVAILABLE", `${item.name} isn't on the menu right now.`)] };
  }
  if (data.branchSettings?.isHidden) {
    return {
      ok: false,
      errors: [err("ITEM_NOT_SOLD_AT_BRANCH", `${item.name} isn't sold at this branch.`)],
    };
  }
  if (data.branchSettings && !data.branchSettings.isAvailable) {
    return { ok: false, errors: [err("ITEM_OUT_OF_STOCK", `Sorry, ${item.name} is out of stock right now.`)] };
  }

  // 2. Line-level checks: collect them all so one reply can fix everything.
  const errors: PricingError[] = [];

  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_QUANTITY) {
    errors.push(
      err("INVALID_QUANTITY", `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`, {
        min: 1,
        max: MAX_QUANTITY,
      }),
    );
  }

  // Size
  const sizes = activeSizes(data.sizes);
  let size: PricingSize | null = null;
  if (sizes.length > 0) {
    const names = sizes.map((s) => s.name);
    if (!input.variantId) {
      errors.push(
        err("SIZE_REQUIRED", `Which size of ${item.name}? ${list(names)}.`, { choices: names }),
      );
    } else {
      size = sizes.find((s) => s.id === input.variantId) ?? null;
      if (!size) {
        errors.push(
          err("INVALID_SIZE", `That size isn't available for ${item.name}. Choose ${list(names)}.`, {
            choices: names,
          }),
        );
      }
    }
  } else if (input.variantId) {
    errors.push(err("INVALID_SIZE", `${item.name} doesn't come in sizes.`));
  }

  // Extras / choices
  const groups = activeGroups(data.groups);
  const requested = input.modifierOptionIds ?? [];
  const byGroup = new Map<string, PricingOption[]>();
  const seen = new Set<string>();

  for (const optionId of requested) {
    if (seen.has(optionId)) {
      errors.push(err("DUPLICATE_OPTION", "The same extra was chosen twice."));
      continue;
    }
    seen.add(optionId);

    const group = groups.find((g) => liveOptions(g).some((o) => o.id === optionId));
    const option = group ? liveOptions(group).find((o) => o.id === optionId) : undefined;
    if (!group || !option) {
      errors.push(err("INVALID_OPTION", `That extra isn't available for ${item.name}.`));
      continue;
    }
    if (!option.isAvailable) {
      const others = liveOptions(group).filter((o) => o.isAvailable && o.id !== option.id).map((o) => o.name);
      errors.push(
        err("OPTION_UNAVAILABLE", `Sorry, ${option.name} isn't available right now.`, {
          groupId: group.id,
          groupName: group.name,
          choices: others,
        }),
      );
      continue;
    }
    byGroup.set(group.id, [...(byGroup.get(group.id) ?? []), option]);
  }

  const selected: SelectedOption[] = [];
  for (const group of groups) {
    const available = liveOptions(group).filter((o) => o.isAvailable);
    let picked = byGroup.get(group.id) ?? [];

    // Nothing chosen in this group → use its available defaults (up to max).
    if (picked.length === 0) {
      picked = available.filter((o) => o.isDefault).slice(0, group.maxSelect);
    }

    const choices = available.map((o) => o.name);
    if (picked.length < group.minSelect) {
      errors.push(
        picked.length === 0
          ? err(
              "REQUIRED_GROUP_MISSING",
              group.minSelect === 1
                ? `Please choose ${group.name.toLowerCase()}: ${list(choices)}.`
                : `Please choose ${group.minSelect} for ${group.name.toLowerCase()}: ${list(choices)}.`,
              { groupId: group.id, groupName: group.name, choices, min: group.minSelect, max: group.maxSelect },
            )
          : err(
              "TOO_FEW_OPTIONS",
              `Please choose at least ${group.minSelect} for ${group.name.toLowerCase()}.`,
              { groupId: group.id, groupName: group.name, choices, min: group.minSelect, max: group.maxSelect },
            ),
      );
    }
    if (picked.length > group.maxSelect) {
      errors.push(
        err(
          "TOO_MANY_OPTIONS",
          group.maxSelect === 1
            ? `Only 1 can be chosen for ${group.name.toLowerCase()}.`
            : `Up to ${group.maxSelect} can be chosen for ${group.name.toLowerCase()}.`,
          { groupId: group.id, groupName: group.name, min: group.minSelect, max: group.maxSelect },
        ),
      );
    }

    for (const o of picked) {
      selected.push({
        id: o.id,
        groupId: group.id,
        groupName: group.name,
        name: o.name,
        nameUr: o.nameUr,
        priceDelta: o.priceDelta,
      });
    }
  }

  // Removals ("no onion")
  const removals: string[] = [];
  for (const raw of input.removals ?? []) {
    const match = item.removableOptions.find((r) => normalize(r) === normalize(raw));
    if (!match) {
      errors.push(
        err(
          "INVALID_REMOVAL",
          item.removableOptions.length
            ? `${raw.trim()} can't be removed from ${item.name}. You can remove: ${list(item.removableOptions)}.`
            : `Nothing can be removed from ${item.name}.`,
          { choices: item.removableOptions },
        ),
      );
    } else if (!removals.includes(match)) {
      removals.push(match);
    }
  }

  // Base price
  let basePrice: number | null;
  if (size) {
    basePrice = effectiveSizePrice(size, data.branchSizePrices);
  } else if (sizes.length === 0) {
    basePrice = effectiveBasePrice(item.basePrice, data.branchSettings);
    if (basePrice === null) {
      errors.push(err("ITEM_NOT_PRICED", `${item.name} doesn't have a price yet.`));
    }
  } else {
    basePrice = null; // size missing/invalid, already reported
  }

  if (errors.length > 0 || basePrice === null) return { ok: false, errors };

  const unitPrice = basePrice + selected.reduce((sum, o) => sum + o.priceDelta, 0);
  const lineTotal = unitPrice * input.quantity;

  const snapshot: CartItemSnapshot = {
    item: { id: item.id, name: item.name, name_ur: item.nameUr },
    size: size ? { id: size.id, name: size.name, name_ur: size.nameUr, price: basePrice } : null,
    base_price: basePrice,
    options: selected.map((o) => ({
      id: o.id,
      group_id: o.groupId,
      group_name: o.groupName,
      name: o.name,
      name_ur: o.nameUr,
      price_delta: o.priceDelta,
    })),
    removals,
    unit_price: unitPrice,
    quantity: input.quantity,
    line_total: lineTotal,
    priced_at: now.toISOString(),
  };

  return {
    ok: true,
    line: {
      itemId: item.id,
      itemName: item.name,
      itemNameUr: item.nameUr,
      variantId: size?.id ?? null,
      sizeName: size?.name ?? null,
      basePrice,
      options: selected,
      removals,
      quantity: input.quantity,
      unitPrice,
      lineTotal,
      snapshot,
    },
  };
}

// ---------------------------------------------------------------------------
// Order totals (subtotal from priced lines + manual fees/discount)
// ---------------------------------------------------------------------------

export type OrderTotals = {
  subtotal: number;
  deliveryFee: number;
  discount: number;
  tax: number;
  serviceCharge: number;
  total: number;
};

export type TotalsError = { code: "INVALID_AMOUNT" | "DISCOUNT_TOO_HIGH"; message: string };

/**
 * Totals for an order. `lines` must come from priceCartItem/resolveCartItem.
 * Matches the database check: total = subtotal + delivery + tax + service − discount.
 */
export function computeOrderTotals(input: {
  lines: { lineTotal: number }[];
  deliveryFee?: number;
  discount?: number;
  tax?: number;
  serviceCharge?: number;
  /** Highest discount allowed, as a % of the subtotal (e.g. 50). */
  maxDiscountPercent?: number;
}): { ok: true; totals: OrderTotals } | { ok: false; error: TotalsError } {
  const deliveryFee = input.deliveryFee ?? 0;
  const discount = input.discount ?? 0;
  const tax = input.tax ?? 0;
  const serviceCharge = input.serviceCharge ?? 0;
  for (const v of [deliveryFee, discount, tax, serviceCharge, ...input.lines.map((l) => l.lineTotal)]) {
    if (!Number.isSafeInteger(v) || v < 0) {
      return { ok: false, error: { code: "INVALID_AMOUNT", message: "Amounts must be whole paisa, not negative." } };
    }
  }
  const subtotal = input.lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const maxPercent = input.maxDiscountPercent ?? 100;
  const maxDiscount = Math.floor((subtotal * maxPercent) / 100);
  if (discount > maxDiscount) {
    return {
      ok: false,
      error: {
        code: "DISCOUNT_TOO_HIGH",
        message: maxPercent >= 100 ? "Discount can't be more than the items total." : `Discount can be at most ${maxPercent}% of the items total.`,
      },
    };
  }
  return {
    ok: true,
    totals: { subtotal, deliveryFee, discount, tax, serviceCharge, total: subtotal + deliveryFee + tax + serviceCharge - discount },
  };
}

// ---------------------------------------------------------------------------
// Branch menu (staff screens + AI bot)
// ---------------------------------------------------------------------------

export type BranchMenuOption = {
  id: string;
  name: string;
  nameUr: string | null;
  priceDelta: number;
  isDefault: boolean;
  isAvailable: boolean;
};

export type BranchMenuItem = {
  id: string;
  name: string;
  nameUr: string | null;
  description: string | null;
  descriptionUr: string | null;
  imageUrl: string | null;
  tags: string[];
  aliases: string[];
  removableOptions: string[];
  prepTimeMinutes: number | null;
  /** In stock at this branch. */
  isAvailable: boolean;
  /** Price for this branch when the item has no sizes. */
  price: number | null;
  /** Lowest size price, for "from Rs X". Equals `price` without sizes. */
  fromPrice: number | null;
  sizes: { id: string; name: string; nameUr: string | null; price: number; isDefault: boolean }[];
  groups: {
    id: string;
    name: string;
    nameUr: string | null;
    minSelect: number;
    maxSelect: number;
    options: BranchMenuOption[];
  }[];
};

export type BranchMenu = {
  branchId: string;
  categories: {
    id: string;
    name: string;
    nameUr: string | null;
    description: string | null;
    items: BranchMenuItem[];
  }[];
};

export type BranchMenuSource = {
  branchId: string;
  categories: {
    id: string;
    name: string;
    nameUr: string | null;
    description: string | null;
    sortOrder: number;
    isActive: boolean;
    archived: boolean;
  }[];
  items: (ItemPricingData["item"] & {
    categoryId: string;
    description: string | null;
    descriptionUr: string | null;
    imageUrl: string | null;
    tags: string[];
    aliases: string[];
    prepTimeMinutes: number | null;
    sortOrder: number;
    sizes: PricingSize[];
    groups: PricingGroup[];
  })[];
  settings: Record<string, NonNullable<ItemPricingData["branchSettings"]>>;
  sizePrices: Record<string, number>;
};

/**
 * Sellable menu for one branch: no archived/inactive categories or items,
 * nothing hidden at the branch. Out-of-stock items stay, flagged
 * isAvailable=false, so staff and the bot can say "sold out".
 */
export function buildBranchMenu(source: BranchMenuSource): BranchMenu {
  const categories = source.categories
    .filter((c) => c.isActive && !c.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  return {
    branchId: source.branchId,
    categories: categories
      .map((c) => ({
        id: c.id,
        name: c.name,
        nameUr: c.nameUr,
        description: c.description,
        items: source.items
          .filter((i) => i.categoryId === c.id && i.isActive && !i.archived)
          .filter((i) => !source.settings[i.id]?.isHidden)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
          .map((i): BranchMenuItem => {
            const settings = source.settings[i.id] ?? null;
            const sizes = activeSizes(i.sizes).map((s) => ({
              id: s.id,
              name: s.name,
              nameUr: s.nameUr,
              price: effectiveSizePrice(s, source.sizePrices),
              isDefault: s.isDefault,
            }));
            const price = sizes.length ? null : effectiveBasePrice(i.basePrice, settings);
            return {
              id: i.id,
              name: i.name,
              nameUr: i.nameUr,
              description: i.description,
              descriptionUr: i.descriptionUr,
              imageUrl: i.imageUrl,
              tags: i.tags,
              aliases: i.aliases,
              removableOptions: i.removableOptions,
              prepTimeMinutes: i.prepTimeMinutes,
              isAvailable: settings?.isAvailable ?? true,
              price,
              fromPrice: sizes.length ? Math.min(...sizes.map((s) => s.price)) : price,
              sizes,
              groups: activeGroups(i.groups).map((g) => ({
                id: g.id,
                name: g.name,
                nameUr: g.nameUr,
                minSelect: g.minSelect,
                maxSelect: g.maxSelect,
                options: liveOptions(g).map((o) => ({
                  id: o.id,
                  name: o.name,
                  nameUr: o.nameUr,
                  priceDelta: o.priceDelta,
                  isDefault: o.isDefault,
                  isAvailable: o.isAvailable,
                })),
              })),
            };
          }),
      }))
      .filter((c) => c.items.length > 0),
  };
}

/**
 * Price a choice straight from a branch menu item (customer menu page,
 * Phase 8). Same engine (priceCartItem), same rules and errors — the page uses
 * it to enforce choices and show live prices; the server re-prices from the
 * database before anything is saved. Pure: safe in the browser.
 */
export function priceMenuItem(
  restaurantId: string,
  branchId: string,
  item: Pick<BranchMenuItem, "id" | "name" | "nameUr" | "price" | "removableOptions" | "sizes" | "groups" | "isAvailable">,
  choice: { variantId?: string | null; modifierOptionIds?: string[]; removals?: string[]; quantity: number },
): PricingResult {
  const data: ItemPricingData = {
    item: {
      id: item.id,
      restaurantId,
      name: item.name,
      nameUr: item.nameUr,
      basePrice: item.price,
      isActive: true,
      archived: false,
      removableOptions: item.removableOptions,
    },
    category: { isActive: true, archived: false },
    sizes: item.sizes.map((sz, i) => ({ ...sz, isActive: true, archived: false, sortOrder: i })),
    groups: item.groups.map((g, gi) => ({
      ...g,
      archived: false,
      sortOrder: gi,
      options: g.options.map((o, oi) => ({ ...o, archived: false, sortOrder: oi })),
    })),
    branch: { id: branchId, restaurantId, isActive: true },
    // `price` is already the branch price; sizes carry branch prices too.
    branchSettings: { isAvailable: item.isAvailable, isHidden: false, priceOverride: null },
    branchSizePrices: {},
  };
  return priceCartItem(data, { restaurantId, branchId, itemId: item.id, ...choice });
}

// ---------------------------------------------------------------------------
// Loaders (database → plain data)
// ---------------------------------------------------------------------------

const ITEM_SELECT = `
  id, restaurant_id, category_id, name, name_ur, description, description_ur, image_url,
  base_price, is_active, archived_at, removable_options, tags, aliases, prep_time_minutes, sort_order,
  category:menu_categories!inner(id, is_active, archived_at),
  sizes:item_variants(id, name, name_ur, price, is_default, is_active, archived_at, sort_order),
  links:item_modifier_groups(sort_order,
    group:modifier_groups(id, name, name_ur, min_select, max_select, archived_at, sort_order,
      options:modifier_options(id, name, name_ur, price_delta, is_default, is_available, archived_at, sort_order)))
`;

type ItemRow = {
  id: string;
  restaurant_id: string;
  category_id: string;
  name: string;
  name_ur: string | null;
  description: string | null;
  description_ur: string | null;
  image_url: string | null;
  base_price: number | null;
  is_active: boolean;
  archived_at: string | null;
  removable_options: string[];
  tags: string[];
  aliases: string[];
  prep_time_minutes: number | null;
  sort_order: number;
  category: { id: string; is_active: boolean; archived_at: string | null };
  sizes: {
    id: string;
    name: string;
    name_ur: string | null;
    price: number;
    is_default: boolean;
    is_active: boolean;
    archived_at: string | null;
    sort_order: number;
  }[];
  links: {
    sort_order: number;
    group: {
      id: string;
      name: string;
      name_ur: string | null;
      min_select: number;
      max_select: number;
      archived_at: string | null;
      sort_order: number;
      options: {
        id: string;
        name: string;
        name_ur: string | null;
        price_delta: number;
        is_default: boolean;
        is_available: boolean;
        archived_at: string | null;
        sort_order: number;
      }[];
    } | null;
  }[];
};

function toSizes(row: ItemRow): PricingSize[] {
  return row.sizes.map((s) => ({
    id: s.id,
    name: s.name,
    nameUr: s.name_ur,
    price: s.price,
    isDefault: s.is_default,
    isActive: s.is_active,
    archived: s.archived_at !== null,
    sortOrder: s.sort_order,
  }));
}

function toGroups(row: ItemRow): PricingGroup[] {
  return row.links
    .filter((l) => l.group !== null)
    .map((l) => ({
      id: l.group!.id,
      name: l.group!.name,
      nameUr: l.group!.name_ur,
      minSelect: l.group!.min_select,
      maxSelect: l.group!.max_select,
      archived: l.group!.archived_at !== null,
      // The item's own ordering of its groups wins.
      sortOrder: l.sort_order,
      options: l.group!.options.map((o) => ({
        id: o.id,
        name: o.name,
        nameUr: o.name_ur,
        priceDelta: o.price_delta,
        isDefault: o.is_default,
        isAvailable: o.is_available,
        archived: o.archived_at !== null,
        sortOrder: o.sort_order,
      })),
    }));
}

function toItem(row: ItemRow): ItemPricingData["item"] {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    nameUr: row.name_ur,
    basePrice: row.base_price,
    isActive: row.is_active,
    archived: row.archived_at !== null,
    removableOptions: row.removable_options,
  };
}

/** Load everything needed to price one item at one branch. */
export async function loadItemPricingData(
  db: Db,
  restaurantId: string,
  branchId: string,
  itemId: string,
): Promise<ItemPricingData | null> {
  const [itemRes, branchRes, settingsRes] = await Promise.all([
    db.from("menu_items").select(ITEM_SELECT).eq("id", itemId).eq("restaurant_id", restaurantId).maybeSingle(),
    db.from("branches").select("id, restaurant_id, is_active").eq("id", branchId).eq("restaurant_id", restaurantId).maybeSingle(),
    db
      .from("branch_item_settings")
      .select("is_available, is_hidden, price_override")
      .eq("branch_id", branchId)
      .eq("item_id", itemId)
      .maybeSingle(),
  ]);
  if (itemRes.error) throw itemRes.error;
  if (branchRes.error) throw branchRes.error;
  if (settingsRes.error) throw settingsRes.error;

  const row = itemRes.data as unknown as ItemRow | null;
  if (!row) return null;

  const sizes = toSizes(row);
  const branchSizePrices: Record<string, number> = {};
  if (sizes.length) {
    const { data, error } = await db
      .from("branch_variant_prices")
      .select("variant_id, price")
      .eq("branch_id", branchId)
      .in("variant_id", sizes.map((s) => s.id));
    if (error) throw error;
    for (const p of data ?? []) branchSizePrices[p.variant_id] = p.price;
  }

  const branch = branchRes.data;
  const settings = settingsRes.data;
  return {
    item: toItem(row),
    category: { isActive: row.category.is_active, archived: row.category.archived_at !== null },
    sizes,
    groups: toGroups(row),
    branch: branch ? { id: branch.id, restaurantId: branch.restaurant_id, isActive: branch.is_active } : null,
    branchSettings: settings
      ? { isAvailable: settings.is_available, isHidden: settings.is_hidden, priceOverride: settings.price_override }
      : null,
    branchSizePrices,
  };
}

/**
 * Validate and price one cart line from the database.
 * Pass the caller's Supabase client (server client for staff, admin client
 * for the WhatsApp webhook).
 */
export async function resolveCartItem(db: Db, input: CartItemInput): Promise<PricingResult> {
  const data = await loadItemPricingData(db, input.restaurantId, input.branchId, input.itemId);
  return priceCartItem(data, input);
}

/** Price several lines; returns all lines or every error per line. */
export async function resolveCart(db: Db, inputs: CartItemInput[]) {
  const results = await Promise.all(inputs.map((i) => resolveCartItem(db, i)));
  const ok = results.every((r) => r.ok);
  return {
    ok,
    results,
    subtotal: ok
      ? results.reduce((sum, r) => sum + (r.ok ? r.line.lineTotal : 0), 0)
      : null,
  };
}

/** The fully resolved, sellable menu of one branch (see buildBranchMenu). */
export async function getBranchMenu(db: Db, restaurantId: string, branchId: string): Promise<BranchMenu> {
  const [cats, items, settings, prices] = await Promise.all([
    db
      .from("menu_categories")
      .select("id, name, name_ur, description, sort_order, is_active, archived_at")
      .eq("restaurant_id", restaurantId),
    db.from("menu_items").select(ITEM_SELECT).eq("restaurant_id", restaurantId).is("archived_at", null),
    db
      .from("branch_item_settings")
      .select("item_id, is_available, is_hidden, price_override")
      .eq("branch_id", branchId)
      .eq("restaurant_id", restaurantId),
    db
      .from("branch_variant_prices")
      .select("variant_id, price")
      .eq("branch_id", branchId)
      .eq("restaurant_id", restaurantId),
  ]);
  for (const r of [cats, items, settings, prices]) if (r.error) throw r.error;

  const rows = (items.data ?? []) as unknown as ItemRow[];
  return buildBranchMenu({
    branchId,
    categories: (cats.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      nameUr: c.name_ur,
      description: c.description,
      sortOrder: c.sort_order,
      isActive: c.is_active,
      archived: c.archived_at !== null,
    })),
    items: rows.map((r) => ({
      ...toItem(r),
      categoryId: r.category_id,
      description: r.description,
      descriptionUr: r.description_ur,
      imageUrl: r.image_url,
      tags: r.tags,
      aliases: r.aliases,
      prepTimeMinutes: r.prep_time_minutes,
      sortOrder: r.sort_order,
      sizes: toSizes(r),
      groups: toGroups(r),
    })),
    settings: Object.fromEntries(
      (settings.data ?? []).map((s) => [
        s.item_id,
        { isAvailable: s.is_available, isHidden: s.is_hidden, priceOverride: s.price_override },
      ]),
    ),
    sizePrices: Object.fromEntries((prices.data ?? []).map((p) => [p.variant_id, p.price])),
  });
}
