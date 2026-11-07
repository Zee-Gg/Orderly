/**
 * Bulk price change maths (pure). The browser uses it for the preview and the
 * server re-runs it on fresh database prices before applying, so what you
 * see is what gets saved.
 */

export type PriceRowKind = "item" | "size" | "item_branch" | "size_branch";

export type PriceRow = {
  kind: PriceRowKind;
  /** item id (item, item_branch) or size id (size, size_branch). */
  id: string;
  branchId?: string;
  itemId: string;
  itemName: string;
  categoryId: string;
  /** "Large", "DHA Branch", "DHA Branch · Large", or "" for a plain item price. */
  label: string;
  price: number;
};

export type BulkPriceRule = {
  direction: "increase" | "decrease";
  mode: "percent" | "fixed";
  /** Percent (10 = 10%) or paisa when mode is "fixed". */
  amount: number;
  /** Nearest multiple of this many paisa (100 = Rs 1, 1000 = Rs 10, 5000 = Rs 50). */
  rounding: number;
};

export type PriceChange = PriceRow & { newPrice: number };

export function changePrice(price: number, rule: BulkPriceRule): number {
  const sign = rule.direction === "increase" ? 1 : -1;
  const raw = rule.mode === "percent" ? price * (1 + (sign * rule.amount) / 100) : price + sign * rule.amount;
  const step = Math.max(1, rule.rounding);
  return Math.round(raw / step) * step;
}

export function computeBulkPrices(rows: PriceRow[], rule: BulkPriceRule) {
  const changes: PriceChange[] = rows.map((r) => ({ ...r, newPrice: changePrice(r.price, rule) }));
  const belowZero = changes.filter((c) => c.newPrice < 0);
  return {
    changes: changes.filter((c) => c.newPrice !== c.price),
    unchanged: changes.filter((c) => c.newPrice === c.price).length,
    belowZero,
  };
}
