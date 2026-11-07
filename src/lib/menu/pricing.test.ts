import { describe, expect, it } from "vitest";
import {
  buildBranchMenu,
  priceCartItem,
  type CartItemInput,
  type ItemPricingData,
  type PricingGroup,
  type PricingSize,
} from "./pricing";

const R = "rest-1";
const B = "branch-1";
const NOW = new Date("2026-11-08T12:00:00Z");

// --- fixture builders --------------------------------------------------------

function size(id: string, name: string, price: number, extra: Partial<PricingSize> = {}): PricingSize {
  return { id, name, nameUr: null, price, isDefault: false, isActive: true, archived: false, sortOrder: 0, ...extra };
}

function group(
  id: string,
  name: string,
  min: number,
  max: number,
  options: [id: string, name: string, delta: number, extra?: Partial<PricingGroup["options"][number]>][],
  extra: Partial<PricingGroup> = {},
): PricingGroup {
  return {
    id,
    name,
    nameUr: null,
    minSelect: min,
    maxSelect: max,
    archived: false,
    sortOrder: 0,
    options: options.map(([oid, oname, delta, o], i) => ({
      id: oid,
      name: oname,
      nameUr: null,
      priceDelta: delta,
      isDefault: false,
      isAvailable: true,
      archived: false,
      sortOrder: i,
      ...o,
    })),
    ...extra,
  };
}

type ItemOverrides = Omit<Partial<ItemPricingData>, "item"> & { item?: Partial<ItemPricingData["item"]> };

function item(overrides: ItemOverrides = {}): ItemPricingData {
  const { item: itemOverrides, ...rest } = overrides;
  return {
    item: {
      id: "zinger",
      restaurantId: R,
      name: "Zinger Burger",
      nameUr: "زنگر برگر",
      basePrice: 55000,
      isActive: true,
      archived: false,
      removableOptions: ["Onion", "Mayo"],
      ...itemOverrides,
    },
    category: { isActive: true, archived: false },
    sizes: [],
    groups: [],
    branch: { id: B, restaurantId: R, isActive: true },
    branchSettings: null,
    branchSizePrices: {},
    ...rest,
  };
}

const pizzaSizes = [
  size("s", "Small", 89900, { sortOrder: 0 }),
  size("m", "Medium", 139900, { sortOrder: 1, isDefault: true }),
  size("l", "Large", 185000, { sortOrder: 2 }),
];
const pizzaExtras = group("extras", "Pizza Extras", 0, 3, [
  ["cheese", "Extra Cheese", 15000],
  ["jalapeno", "Jalapeños", 10000],
  ["sauce", "Extra Sauce", 5000],
  ["olives", "Olives", 8000],
]);
const spice = group("spice", "Spice level", 1, 1, [
  ["mild", "Mild", 0],
  ["medium", "Medium", 0],
  ["hot", "Spicy", 0],
]);

function pizza(overrides: ItemOverrides = {}) {
  return item({
    item: { id: "tikka", name: "Chicken Tikka Pizza", nameUr: null, basePrice: null, removableOptions: ["Onion", "Olives"] },
    sizes: pizzaSizes,
    groups: [pizzaExtras],
    ...overrides,
  });
}

function input(extra: Partial<CartItemInput> = {}): CartItemInput {
  return { restaurantId: R, branchId: B, itemId: "zinger", quantity: 1, ...extra };
}

function codes(result: ReturnType<typeof priceCartItem>) {
  return result.ok ? [] : result.errors.map((e) => e.code);
}

// --- tests -------------------------------------------------------------------

describe("items without sizes", () => {
  it("uses the base price", () => {
    const r = priceCartItem(item(), input(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.line.unitPrice).toBe(55000);
    expect(r.line.lineTotal).toBe(55000);
    expect(r.line.sizeName).toBeNull();
  });

  it("uses the branch price override", () => {
    const r = priceCartItem(
      item({ branchSettings: { isAvailable: true, isHidden: false, priceOverride: 60000 } }),
      input(),
      NOW,
    );
    expect(r.ok && r.line.unitPrice).toBe(60000);
  });

  it("rejects a size on an item that has no sizes", () => {
    expect(codes(priceCartItem(item(), input({ variantId: "x" }), NOW))).toEqual(["INVALID_SIZE"]);
  });

  it("rejects an unsized item with no price", () => {
    expect(codes(priceCartItem(item({ item: { basePrice: null } }), input(), NOW))).toEqual(["ITEM_NOT_PRICED"]);
  });
});

describe("items with sizes", () => {
  it("requires a size and lists the choices", () => {
    const r = priceCartItem(pizza(), input({ itemId: "tikka" }), NOW);
    expect(codes(r)).toEqual(["SIZE_REQUIRED"]);
    if (!r.ok) expect(r.errors[0].choices).toEqual(["Small", "Medium", "Large"]);
  });

  it("uses the full size price (not a difference)", () => {
    const r = priceCartItem(pizza(), input({ itemId: "tikka", variantId: "l" }), NOW);
    expect(r.ok && r.line.unitPrice).toBe(185000);
    expect(r.ok && r.line.sizeName).toBe("Large");
  });

  it("uses the branch size price when set", () => {
    const r = priceCartItem(pizza({ branchSizePrices: { l: 199000 } }), input({ itemId: "tikka", variantId: "l" }), NOW);
    expect(r.ok && r.line.unitPrice).toBe(199000);
  });

  it("ignores the item price override when the item has sizes", () => {
    const r = priceCartItem(
      pizza({ branchSettings: { isAvailable: true, isHidden: false, priceOverride: 1 } }),
      input({ itemId: "tikka", variantId: "s" }),
      NOW,
    );
    expect(r.ok && r.line.unitPrice).toBe(89900);
  });

  it("rejects unknown, inactive and archived sizes", () => {
    const sizes = [...pizzaSizes, size("xl", "XL", 250000, { isActive: false }), size("old", "Family", 300000, { archived: true })];
    for (const variantId of ["nope", "xl", "old"]) {
      expect(codes(priceCartItem(pizza({ sizes }), input({ itemId: "tikka", variantId }), NOW))).toEqual(["INVALID_SIZE"]);
    }
  });

  it("treats an item whose sizes are all archived as unsized", () => {
    const data = pizza({ sizes: [size("old", "Old", 1, { archived: true })] });
    data.item.basePrice = 99900;
    const r = priceCartItem(data, input({ itemId: "tikka" }), NOW);
    expect(r.ok && r.line.unitPrice).toBe(99900);
  });
});

describe("extras and choices", () => {
  it("adds option prices to the unit price", () => {
    const r = priceCartItem(pizza(), input({ itemId: "tikka", variantId: "m", modifierOptionIds: ["cheese", "sauce"] }), NOW);
    expect(r.ok && r.line.unitPrice).toBe(139900 + 15000 + 5000);
    expect(r.ok && r.line.options.map((o) => o.name)).toEqual(["Extra Cheese", "Extra Sauce"]);
  });

  it("enforces max_select", () => {
    const r = priceCartItem(
      pizza(),
      input({ itemId: "tikka", variantId: "m", modifierOptionIds: ["cheese", "jalapeno", "sauce", "olives"] }),
      NOW,
    );
    expect(codes(r)).toEqual(["TOO_MANY_OPTIONS"]);
  });

  it("reports a missing required group with its choices", () => {
    const r = priceCartItem(item({ groups: [spice] }), input(), NOW);
    expect(codes(r)).toEqual(["REQUIRED_GROUP_MISSING"]);
    if (!r.ok) {
      expect(r.errors[0].groupName).toBe("Spice level");
      expect(r.errors[0].choices).toEqual(["Mild", "Medium", "Spicy"]);
    }
  });

  it("enforces min_select above 1", () => {
    const sauces = group("sauces", "Dips", 2, 3, [
      ["a", "Garlic", 0],
      ["b", "Chilli", 0],
      ["c", "Mint", 0],
    ]);
    expect(codes(priceCartItem(item({ groups: [sauces] }), input({ modifierOptionIds: ["a"] }), NOW))).toEqual([
      "TOO_FEW_OPTIONS",
    ]);
    expect(priceCartItem(item({ groups: [sauces] }), input({ modifierOptionIds: ["a", "b"] }), NOW).ok).toBe(true);
  });

  it("applies default options when the group is left empty", () => {
    const withDefault = group("spice", "Spice level", 1, 1, [
      ["mild", "Mild", 0],
      ["medium", "Medium", 0, { isDefault: true }],
    ]);
    const r = priceCartItem(item({ groups: [withDefault] }), input(), NOW);
    expect(r.ok && r.line.options.map((o) => o.name)).toEqual(["Medium"]);
  });

  it("does not add defaults when the customer chose something in the group", () => {
    const withDefault = group("drink", "Choose your drink", 1, 1, [
      ["coke", "Coke", 0, { isDefault: true }],
      ["mint", "Mint Margarita", 10000],
    ]);
    const r = priceCartItem(item({ groups: [withDefault] }), input({ modifierOptionIds: ["mint"] }), NOW);
    expect(r.ok && r.line.options.map((o) => o.name)).toEqual(["Mint Margarita"]);
    expect(r.ok && r.line.unitPrice).toBe(55000 + 10000);
  });

  it("skips unavailable defaults", () => {
    const g = group("spice", "Spice level", 1, 1, [["medium", "Medium", 0, { isDefault: true, isAvailable: false }]]);
    expect(codes(priceCartItem(item({ groups: [g] }), input(), NOW))).toEqual(["REQUIRED_GROUP_MISSING"]);
  });

  it("rejects options that don't belong to the item", () => {
    expect(codes(priceCartItem(pizza(), input({ itemId: "tikka", variantId: "s", modifierOptionIds: ["mild"] }), NOW))).toEqual([
      "INVALID_OPTION",
    ]);
  });

  it("rejects archived options and options of archived groups", () => {
    const archivedOpt = group("g", "Extras", 0, 3, [["x", "Old", 100, { archived: true }]]);
    expect(codes(priceCartItem(item({ groups: [archivedOpt] }), input({ modifierOptionIds: ["x"] }), NOW))).toEqual([
      "INVALID_OPTION",
    ]);
    const archivedGroup = group("g", "Extras", 0, 3, [["y", "Thing", 100]], { archived: true });
    expect(codes(priceCartItem(item({ groups: [archivedGroup] }), input({ modifierOptionIds: ["y"] }), NOW))).toEqual([
      "INVALID_OPTION",
    ]);
  });

  it("an archived required group no longer blocks ordering", () => {
    const archived = { ...spice, archived: true };
    expect(priceCartItem(item({ groups: [archived] }), input(), NOW).ok).toBe(true);
  });

  it("rejects unavailable options and suggests others", () => {
    const g = group("drink", "Choose your drink", 1, 1, [
      ["coke", "Coke", 0, { isAvailable: false }],
      ["sprite", "Sprite", 0],
    ]);
    const r = priceCartItem(item({ groups: [g] }), input({ modifierOptionIds: ["coke"] }), NOW);
    expect(codes(r)).toContain("OPTION_UNAVAILABLE");
    if (!r.ok) expect(r.errors.find((e) => e.code === "OPTION_UNAVAILABLE")?.choices).toEqual(["Sprite"]);
  });

  it("rejects the same option twice", () => {
    expect(codes(priceCartItem(pizza(), input({ itemId: "tikka", variantId: "s", modifierOptionIds: ["cheese", "cheese"] }), NOW))).toEqual([
      "DUPLICATE_OPTION",
    ]);
  });

  it("collects several problems at once", () => {
    const r = priceCartItem(
      pizza({ groups: [pizzaExtras, spice] }),
      input({ itemId: "tikka", modifierOptionIds: ["nope"] }),
      NOW,
    );
    expect(codes(r).sort()).toEqual(["INVALID_OPTION", "REQUIRED_GROUP_MISSING", "SIZE_REQUIRED"]);
  });
});

describe("removals", () => {
  it("accepts removals case-insensitively and normalises names", () => {
    const r = priceCartItem(item(), input({ removals: ["  onion ", "MAYO", "Onion"] }), NOW);
    expect(r.ok && r.line.removals).toEqual(["Onion", "Mayo"]);
  });

  it("rejects things that can't be removed", () => {
    const r = priceCartItem(item(), input({ removals: ["Bun"] }), NOW);
    expect(codes(r)).toEqual(["INVALID_REMOVAL"]);
    if (!r.ok) expect(r.errors[0].choices).toEqual(["Onion", "Mayo"]);
  });
});

describe("availability", () => {
  it("rejects out-of-stock items", () => {
    const r = priceCartItem(item({ branchSettings: { isAvailable: false, isHidden: false, priceOverride: null } }), input(), NOW);
    expect(codes(r)).toEqual(["ITEM_OUT_OF_STOCK"]);
  });

  it("rejects items hidden at the branch", () => {
    const r = priceCartItem(item({ branchSettings: { isAvailable: true, isHidden: true, priceOverride: null } }), input(), NOW);
    expect(codes(r)).toEqual(["ITEM_NOT_SOLD_AT_BRANCH"]);
  });

  it("rejects archived items", () => {
    expect(codes(priceCartItem(item({ item: { archived: true } }), input(), NOW))).toEqual(["ITEM_ARCHIVED"]);
  });

  it("rejects inactive items and items in hidden or archived categories", () => {
    expect(codes(priceCartItem(item({ item: { isActive: false } }), input(), NOW))).toEqual(["ITEM_UNAVAILABLE"]);
    expect(codes(priceCartItem(item({ category: { isActive: false, archived: false } }), input(), NOW))).toEqual(["ITEM_UNAVAILABLE"]);
    expect(codes(priceCartItem(item({ category: { isActive: true, archived: true } }), input(), NOW))).toEqual(["ITEM_UNAVAILABLE"]);
  });

  it("rejects missing items, other restaurants' items and inactive branches", () => {
    expect(codes(priceCartItem(null, input(), NOW))).toEqual(["ITEM_NOT_FOUND"]);
    expect(codes(priceCartItem(item({ item: { restaurantId: "other" } }), input(), NOW))).toEqual(["ITEM_NOT_FOUND"]);
    expect(codes(priceCartItem(item({ branch: null }), input(), NOW))).toEqual(["BRANCH_NOT_FOUND"]);
    expect(codes(priceCartItem(item({ branch: { id: B, restaurantId: R, isActive: false } }), input(), NOW))).toEqual([
      "BRANCH_NOT_FOUND",
    ]);
  });
});

describe("quantities and the snapshot", () => {
  it("multiplies the unit price by quantity", () => {
    const r = priceCartItem(pizza(), input({ itemId: "tikka", variantId: "s", modifierOptionIds: ["cheese"], quantity: 3 }), NOW);
    expect(r.ok && r.line.unitPrice).toBe(104900);
    expect(r.ok && r.line.lineTotal).toBe(314700);
  });

  it("rejects zero, negative, fractional and huge quantities", () => {
    for (const quantity of [0, -1, 1.5, 100, Number.NaN]) {
      expect(codes(priceCartItem(item(), input({ quantity }), NOW))).toEqual(["INVALID_QUANTITY"]);
    }
  });

  it("returns a frozen snapshot of names and prices", () => {
    const r = priceCartItem(
      pizza(),
      input({ itemId: "tikka", variantId: "l", modifierOptionIds: ["jalapeno"], removals: ["olives"], quantity: 2 }),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.line.snapshot).toEqual({
      item: { id: "tikka", name: "Chicken Tikka Pizza", name_ur: null },
      size: { id: "l", name: "Large", name_ur: null, price: 185000 },
      base_price: 185000,
      options: [
        { id: "jalapeno", group_id: "extras", group_name: "Pizza Extras", name: "Jalapeños", name_ur: null, price_delta: 10000 },
      ],
      removals: ["Olives"],
      unit_price: 195000,
      quantity: 2,
      line_total: 390000,
      priced_at: "2026-11-08T12:00:00.000Z",
    });
  });

  it("produces integer paisa only", () => {
    const r = priceCartItem(pizza(), input({ itemId: "tikka", variantId: "m", modifierOptionIds: ["cheese", "olives"], quantity: 7 }), NOW);
    expect(r.ok && Number.isInteger(r.line.lineTotal)).toBe(true);
  });
});

describe("buildBranchMenu", () => {
  it("returns only sellable items with branch prices, keeping out-of-stock flagged", () => {
    const base = {
      categoryId: "pizza",
      description: null,
      descriptionUr: null,
      imageUrl: null,
      tags: [],
      aliases: [],
      prepTimeMinutes: null,
      groups: [],
    };
    const menu = buildBranchMenu({
      branchId: B,
      categories: [
        { id: "pizza", name: "Pizza", nameUr: null, description: null, sortOrder: 0, isActive: true, archived: false },
        { id: "old", name: "Old", nameUr: null, description: null, sortOrder: 1, isActive: true, archived: true },
      ],
      items: [
        { ...pizza().item, ...base, id: "tikka", sortOrder: 1, sizes: pizzaSizes },
        { ...item().item, ...base, id: "fries", name: "Fries", basePrice: 45000, sortOrder: 0, sizes: [] },
        { ...item().item, ...base, id: "hidden", sortOrder: 2, sizes: [] },
        { ...item().item, ...base, id: "gone", archived: true, sortOrder: 3, sizes: [] },
      ],
      settings: {
        fries: { isAvailable: false, isHidden: false, priceOverride: 50000 },
        hidden: { isAvailable: true, isHidden: true, priceOverride: null },
      },
      sizePrices: { s: 79900 },
    });

    expect(menu.categories.map((c) => c.id)).toEqual(["pizza"]);
    const items = menu.categories[0].items;
    expect(items.map((i) => i.id)).toEqual(["fries", "tikka"]);
    expect(items[0]).toMatchObject({ isAvailable: false, price: 50000, fromPrice: 50000 });
    expect(items[1]).toMatchObject({ isAvailable: true, price: null, fromPrice: 79900 });
    expect(items[1].sizes.map((s) => s.price)).toEqual([79900, 139900, 185000]);
  });
});
