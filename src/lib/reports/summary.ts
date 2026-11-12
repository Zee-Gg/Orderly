import { formatPKR } from "@/lib/money";
import { percentChange, type ResolvedRange } from "@/lib/reports/range";

/**
 * The friendly sentence at the top of /reports. Built by CODE from templates
 * (never by the AI), in plain English. Pure: same input → same sentence.
 */
export type SummaryPart = { text: string; bold?: boolean };
export type Summary = { tone: "up" | "down" | "steady" | "empty"; parts: SummaryPart[] };

export type SummaryInput = {
  range: Pick<ResolvedRange, "key" | "days" | "compareLabel">;
  orders: number;
  sales: number;
  previousOrders: number;
  open: number;
  topItem: string | null;
  /** 24 numbers, orders per hour of day. */
  hours: number[];
};

/** "8 PM", "12 AM" */
export function hourLabel(h: number): string {
  const hour = ((h % 24) + 24) % 24;
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${suffix}`;
}

/** "8 and 10 PM", "11 AM and 1 PM" */
export function hourWindowLabel(start: number, length = 2): string {
  const end = (start + length) % 24;
  const a = hourLabel(start);
  const b = hourLabel(end);
  const sameHalf = a.slice(-2) === b.slice(-2);
  return sameHalf ? `${a.slice(0, -3)} and ${b}` : `${a} and ${b}`;
}

/** Busiest 2-hour window, or null with no orders. */
export function peakWindow(hours: number[], length = 2): { start: number; orders: number } | null {
  if (hours.length !== 24 || hours.every((n) => n === 0)) return null;
  let best = { start: 0, orders: -1 };
  for (let start = 0; start < 24; start++) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += hours[(start + i) % 24];
    if (sum > best.orders) best = { start, orders: sum };
  }
  return best;
}

function unit(range: SummaryInput["range"]) {
  if (range.days === 1) return "day";
  if (range.key === "week") return "week";
  if (range.key === "month" || range.key === "last_month") return "month";
  return "stretch";
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-PK")} ${n === 1 ? one : many}`;
}

export function buildSummary(input: SummaryInput): Summary {
  const { orders, previousOrders, open, topItem } = input;
  const u = unit(input.range);

  if (orders === 0) {
    const parts: SummaryPart[] = [{ text: "No completed orders in this period yet." }];
    if (open > 0) parts.push({ text: ` ${plural(open, "order is", "orders are")} still in progress.` });
    return { tone: "empty", parts };
  }

  const change = percentChange(orders, previousOrders);
  const top: SummaryPart[] = topItem ? [{ text: " " }, { text: topItem, bold: true }, { text: " was your top seller." }] : [];
  const peak = peakWindow(input.hours);
  const busy: SummaryPart[] = peak ? [{ text: ` Most orders came between ${hourWindowLabel(peak.start)}.` }] : [];

  if (change === null) {
    return {
      tone: "steady",
      parts: [{ text: `${plural(orders, "order")} and ${formatPKR(input.sales)} in sales.` }, ...(top.length ? top : busy)],
    };
  }
  if (change >= 5) {
    return {
      tone: "up",
      parts: [
        { text: `Great ${u}!`, bold: true },
        { text: ` ${plural(orders, "order")}, ${change}% more than ${input.range.compareLabel}.` },
        ...(top.length ? top : busy),
      ],
    };
  }
  if (change <= -5) {
    return {
      tone: "down",
      parts: [
        { text: `Slower ${u}:`, bold: true },
        { text: ` ${plural(orders, "order")}, ${Math.abs(change)}% fewer than ${input.range.compareLabel}.` },
        ...(busy.length ? busy : top),
      ],
    };
  }
  return {
    tone: "steady",
    parts: [
      { text: `Steady ${u}:`, bold: true },
      { text: ` ${plural(orders, "order")}, about the same as ${input.range.compareLabel}.` },
      ...(top.length ? top : busy),
    ],
  };
}
