import { describe, expect, it } from "vitest";
import { changePrice, computeBulkPrices, type PriceRow } from "./bulk-price";

const row = (price: number, id = "a"): PriceRow => ({
  kind: "item",
  id,
  itemId: id,
  itemName: "Zinger",
  categoryId: "c",
  label: "",
  price,
});

describe("changePrice", () => {
  it("increases by percent and rounds to Rs 1", () => {
    expect(changePrice(55000, { direction: "increase", mode: "percent", amount: 10, rounding: 100 })).toBe(60500);
    expect(changePrice(89900, { direction: "increase", mode: "percent", amount: 7, rounding: 100 })).toBe(96200);
  });

  it("rounds to the nearest Rs 10 and Rs 50", () => {
    expect(changePrice(89900, { direction: "increase", mode: "percent", amount: 10, rounding: 1000 })).toBe(99000);
    expect(changePrice(139900, { direction: "increase", mode: "percent", amount: 10, rounding: 5000 })).toBe(155000);
  });

  it("decreases by a fixed amount", () => {
    expect(changePrice(55000, { direction: "decrease", mode: "fixed", amount: 5000, rounding: 100 })).toBe(50000);
  });
});

describe("computeBulkPrices", () => {
  it("skips prices that don't change and flags negatives", () => {
    const result = computeBulkPrices([row(10000, "a"), row(0, "b"), row(2000, "c")], {
      direction: "decrease",
      mode: "fixed",
      amount: 5000,
      rounding: 100,
    });
    expect(result.changes.map((c) => c.newPrice)).toEqual([5000, -5000, -3000]);
    expect(result.belowZero.map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("returns integers only", () => {
    const result = computeBulkPrices([row(33333)], { direction: "increase", mode: "percent", amount: 3.3, rounding: 100 });
    expect(Number.isInteger(result.changes[0].newPrice)).toBe(true);
  });
});
