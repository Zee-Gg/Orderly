import { formatPKR } from "@/lib/money";
import type { BranchMenu, BranchMenuItem } from "@/lib/menu/pricing";

/**
 * Short references for the AI: items "I1", sizes "S1", extras/choices "O1".
 * Short refs are cheaper than UUIDs and can't be miscopied; the code maps
 * them back to real ids. Built from the branch menu in a stable order, so
 * the same menu always gives the same refs (good for prompt caching).
 */
export type MenuIndex = {
  menu: BranchMenu;
  items: Map<string, { item: BranchMenuItem; category: string }>;
  itemRef: Map<string, string>; // item id → "I3"
  sizes: Map<string, { itemId: string; id: string; name: string }>;
  sizeRef: Map<string, string>; // size id → "S2"
  options: Map<string, { id: string; name: string; groupName: string }>;
  optionRef: Map<string, string>; // option id → "O5"
  itemCount: number;
};

export function buildMenuIndex(menu: BranchMenu): MenuIndex {
  const idx: MenuIndex = {
    menu,
    items: new Map(),
    itemRef: new Map(),
    sizes: new Map(),
    sizeRef: new Map(),
    options: new Map(),
    optionRef: new Map(),
    itemCount: 0,
  };
  let i = 0;
  let s = 0;
  let o = 0;
  for (const c of menu.categories) {
    for (const item of c.items) {
      const ref = `I${++i}`;
      idx.items.set(ref, { item, category: c.name });
      idx.itemRef.set(item.id, ref);
      for (const size of item.sizes) {
        if (idx.sizeRef.has(size.id)) continue;
        const sref = `S${++s}`;
        idx.sizes.set(sref, { itemId: item.id, id: size.id, name: size.name });
        idx.sizeRef.set(size.id, sref);
      }
      for (const g of item.groups) {
        for (const opt of g.options) {
          if (idx.optionRef.has(opt.id)) continue;
          const oref = `O${++o}`;
          idx.options.set(oref, { id: opt.id, name: opt.name, groupName: g.name });
          idx.optionRef.set(opt.id, oref);
        }
      }
    }
  }
  idx.itemCount = i;
  return idx;
}

const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

/** "I3" or a real item id → the menu item. */
export function findItem(idx: MenuIndex, ref: string): BranchMenuItem | null {
  const r = ref.trim();
  const byRef = idx.items.get(r.toUpperCase());
  if (byRef) return byRef.item;
  for (const { item } of idx.items.values()) if (item.id === r) return item;
  return null;
}

/** Size by ref ("S2"), id, or name ("Large", "large") for this item. */
export function findSize(idx: MenuIndex, item: BranchMenuItem, value: string): string | null {
  const v = value.trim();
  const byRef = idx.sizes.get(v.toUpperCase());
  if (byRef && byRef.itemId === item.id) return byRef.id;
  const s = item.sizes.find((x) => x.id === v || norm(x.name) === norm(v) || (x.nameUr && x.nameUr === v));
  if (s) return s.id;
  // "L" / "lrg" / "med" style shortcuts: unique prefix match.
  const prefix = item.sizes.filter((x) => norm(x.name).startsWith(norm(v)) && norm(v).length >= 1);
  return prefix.length === 1 ? prefix[0].id : null;
}

/** Extra/choice by ref ("O5"), id or name, within this item's groups. Unknown → returned as-is (pricing rejects it). */
export function findOption(idx: MenuIndex, item: BranchMenuItem, value: string): string {
  const v = value.trim();
  const byRef = idx.options.get(v.toUpperCase());
  const all = item.groups.flatMap((g) => g.options);
  if (byRef && all.some((o) => o.id === byRef.id)) return byRef.id;
  const o = all.find((x) => x.id === v || norm(x.name) === norm(v));
  return o ? o.id : v;
}

/** Removal names matched to the item's "Can be removed" list (case-insensitive). */
export function matchRemovals(item: BranchMenuItem, values: string[]): string[] {
  return values.map((v) => item.removableOptions.find((r) => norm(r) === norm(v)) ?? v.trim());
}

export const money = (paisa: number | null | undefined) => (paisa == null ? null : formatPKR(paisa));

/** Item details for the AI (search_menu results and choices on errors). */
export function describeItem(idx: MenuIndex, item: BranchMenuItem, category?: string) {
  return {
    item_id: idx.itemRef.get(item.id) ?? item.id,
    name: item.name,
    ...(item.nameUr ? { name_ur: item.nameUr } : {}),
    ...(category ? { category } : {}),
    available: item.isAvailable,
    ...(item.sizes.length
      ? { sizes: item.sizes.map((s) => ({ size_id: idx.sizeRef.get(s.id) ?? s.id, name: s.name, price: money(s.price) })) }
      : { price: money(item.price) }),
    ...(item.groups.length
      ? {
          choices: item.groups.map((g) => ({
            group: g.name,
            required: g.minSelect > 0,
            min: g.minSelect,
            max: g.maxSelect,
            ...(g.options.some((o) => o.isDefault) ? { default: g.options.filter((o) => o.isDefault).map((o) => o.name) } : {}),
            options: g.options
              .filter((o) => o.isAvailable)
              .map((o) => ({ option_id: idx.optionRef.get(o.id) ?? o.id, name: o.name, extra_price: o.priceDelta ? money(o.priceDelta) : "free" })),
          })),
        }
      : {}),
    ...(item.removableOptions.length ? { can_remove: item.removableOptions } : {}),
  };
}

/** Compact menu for the system prompt: one line per item. */
export function compactMenu(idx: MenuIndex): string {
  const lines: string[] = [];
  for (const c of idx.menu.categories) {
    if (!c.items.length) continue;
    lines.push(`[${c.name}${c.nameUr ? ` / ${c.nameUr}` : ""}]`);
    for (const item of c.items) {
      const parts = [`${idx.itemRef.get(item.id)} ${item.name}${item.nameUr ? ` (${item.nameUr})` : ""}`];
      if (item.aliases.length) parts.push(`also called: ${item.aliases.join(", ")}`);
      parts.push(
        item.sizes.length
          ? `sizes: ${item.sizes.map((s) => `${idx.sizeRef.get(s.id)} ${s.name} ${money(s.price)}`).join(", ")}`
          : `price: ${money(item.price)}`,
      );
      for (const g of item.groups) {
        const rule = g.minSelect > 0 ? `required, pick ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}-${g.maxSelect}`}` : `optional, up to ${g.maxSelect}`;
        const opts = g.options
          .filter((o) => o.isAvailable)
          .map((o) => `${idx.optionRef.get(o.id)} ${o.name}${o.priceDelta ? ` +${money(o.priceDelta)}` : ""}${o.isDefault ? " (default)" : ""}`)
          .join(", ");
        parts.push(`${g.name} (${rule}): ${opts}`);
      }
      if (item.removableOptions.length) parts.push(`can remove: ${item.removableOptions.join(", ")}`);
      if (!item.isAvailable) parts.push("SOLD OUT today");
      lines.push(`- ${parts.join(" | ")}`);
    }
  }
  return lines.join("\n");
}
