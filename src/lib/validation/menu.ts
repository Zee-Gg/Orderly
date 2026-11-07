import { z } from "zod";

export const MENU_TAGS = ["bestseller", "spicy", "new", "vegetarian", "deal", "popular"] as const;
export type MenuTag = (typeof MENU_TAGS)[number];
export const TAG_LABELS: Record<MenuTag, string> = {
  bestseller: "Bestseller",
  spicy: "Spicy",
  new: "New",
  vegetarian: "Vegetarian",
  deal: "Deal",
  popular: "Popular",
};

/** Integer paisa, Rs 0 – Rs 1,000,000. */
export const paisaSchema = z
  .number({ error: "Please enter a price" })
  .int("Use whole paisa")
  .min(0, "Price can't be below Rs 0")
  .max(100_000_000, "That price is too high");

const optional = (max: number) => z.string().trim().max(max, "Too long").optional().default("");

/** Short words: removals and other names customers use. */
const chipList = (maxItems: number, maxLength: number, label: string) =>
  z
    .array(z.string().trim().min(1).max(maxLength, `Each ${label} must be ${maxLength} characters or fewer`))
    .max(maxItems, `Up to ${maxItems} ${label}s`)
    .transform((list) => {
      const seen = new Set<string>();
      return list.filter((v) => {
        const key = v.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });

export const categorySchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Please enter a name").max(60, "Name is too long"),
  nameUr: optional(60),
  isActive: z.boolean().default(true),
});
export type CategoryInput = z.input<typeof categorySchema>;

const sizeSchema = z.object({
  id: z.uuid().optional(),
  /** Stable key so branch prices can refer to new (unsaved) sizes. */
  key: z.string().min(1).max(60),
  name: z.string().trim().min(1, "Name the size, e.g. Small").max(40, "Name is too long"),
  nameUr: optional(40),
  price: paisaSchema,
  isDefault: z.boolean().default(false),
});

const branchSettingSchema = z.object({
  branchId: z.uuid(),
  isHidden: z.boolean(),
  isAvailable: z.boolean(),
  priceOverride: paisaSchema.nullable(),
  sizePrices: z.array(z.object({ sizeKey: z.string().min(1), price: paisaSchema })).max(20),
});

export const itemSchema = z
  .object({
    id: z.uuid().optional(),
    categoryId: z.uuid("Please choose a category"),
    name: z.string().trim().min(1, "Please enter the item name").max(80, "Name is too long"),
    nameUr: optional(80),
    description: optional(500),
    descriptionUr: optional(500),
    imageUrl: z.string().trim().max(1000).optional().default(""),
    hasSizes: z.boolean(),
    basePrice: paisaSchema.nullable(),
    isActive: z.boolean(),
    tags: z.array(z.enum(MENU_TAGS)).max(MENU_TAGS.length),
    prepTimeMinutes: z.number().int().min(0, "Can't be negative").max(240, "Up to 240 minutes").nullable(),
    aliases: chipList(30, 60, "name"),
    removableOptions: chipList(30, 40, "item"),
    sizes: z.array(sizeSchema).max(10, "Up to 10 sizes"),
    groupIds: z.array(z.uuid()).max(20, "Up to 20 extras groups"),
    branches: z.array(branchSettingSchema).max(50),
  })
  .superRefine((v, ctx) => {
    if (v.hasSizes) {
      if (v.sizes.length === 0) {
        ctx.addIssue({ code: "custom", path: ["sizes"], message: "Add at least one size, or turn sizes off" });
      }
      if (v.sizes.filter((s) => s.isDefault).length > 1) {
        ctx.addIssue({ code: "custom", path: ["sizes"], message: "Only one size can be the default" });
      }
      const names = v.sizes.map((s) => s.name.trim().toLowerCase());
      names.forEach((n, i) => {
        if (names.indexOf(n) !== i) {
          ctx.addIssue({ code: "custom", path: ["sizes", i, "name"], message: "Two sizes have the same name" });
        }
      });
    } else if (v.basePrice === null) {
      ctx.addIssue({ code: "custom", path: ["basePrice"], message: "Please enter a price" });
    }
    if (new Set(v.groupIds).size !== v.groupIds.length) {
      ctx.addIssue({ code: "custom", path: ["groupIds"], message: "An extras group was added twice" });
    }
  });
export type ItemInput = z.input<typeof itemSchema>;
export type ItemData = z.output<typeof itemSchema>;

const optionSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name the choice").max(60, "Name is too long"),
  nameUr: optional(60),
  priceDelta: paisaSchema,
  isDefault: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
});

export const groupSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1, "Please name this group, e.g. Pizza Extras").max(60, "Name is too long"),
    nameUr: optional(60),
    minSelect: z.number().int().min(0).max(50),
    maxSelect: z.number().int().min(1, "Customers must be able to pick at least 1").max(50),
    options: z.array(optionSchema).min(1, "Add at least one choice").max(50, "Up to 50 choices"),
  })
  .superRefine((v, ctx) => {
    if (v.maxSelect < v.minSelect) {
      ctx.addIssue({ code: "custom", path: ["maxSelect"], message: "“Up to” must be at least the minimum" });
    }
    if (v.minSelect > v.options.length) {
      ctx.addIssue({ code: "custom", path: ["minSelect"], message: "There aren't enough choices for this minimum" });
    }
    if (v.options.filter((o) => o.isDefault).length > v.maxSelect) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Too many choices are marked as default" });
    }
    const names = v.options.map((o) => o.name.trim().toLowerCase());
    names.forEach((n, i) => {
      if (names.indexOf(n) !== i) {
        ctx.addIssue({ code: "custom", path: ["options", i, "name"], message: "Two choices have the same name" });
      }
    });
  });
export type GroupInput = z.input<typeof groupSchema>;

export const bulkPriceSchema = z.object({
  categoryId: z.uuid().nullable(),
  direction: z.enum(["increase", "decrease"]),
  mode: z.enum(["percent", "fixed"]),
  /** Percent (e.g. 10 = 10%) or paisa for "fixed". */
  amount: z.number().positive("Enter an amount above 0").max(100_000_000),
  /** Round results to the nearest N paisa: 100 (Rs 1), 1000 (Rs 10), 5000 (Rs 50). */
  rounding: z.union([z.literal(100), z.literal(1000), z.literal(5000)]),
});
export type BulkPriceInput = z.input<typeof bulkPriceSchema>;

/** "Customer must choose 1", "Customer can choose up to 3", "Optional". */
export function groupRuleText(min: number, max: number) {
  if (min === 0) return max === 1 ? "Optional · customer can choose 1" : `Optional · customer can choose up to ${max}`;
  if (min === max) return `Customer must choose ${min}`;
  return `Customer must choose ${min} to ${max}`;
}
