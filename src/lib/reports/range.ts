import { DEFAULT_TIMEZONE, localDate } from "@/lib/time";

/**
 * Report date ranges (pure). All dates are LOCAL dates (YYYY-MM-DD) in the
 * restaurant's time zone; the database turns them into UTC bounds.
 */
export const RANGE_KEYS = ["today", "yesterday", "week", "month", "last_month", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  month: "This month",
  last_month: "Last month",
  custom: "Custom",
};

export const MAX_RANGE_DAYS = 366;

export type DateRange = { from: string; to: string };

export type ResolvedRange = DateRange & {
  key: RangeKey;
  /** "Today", "This week", "1 Nov – 13 Nov" */
  label: string;
  /** Same length, just before (single days: same weekday last week). */
  compare: DateRange;
  /** "last Friday", "last week", "the previous 13 days" */
  compareLabel: string;
  /** Days the "sales by day" chart covers (at least the last 7 days). */
  chart: DateRange;
  days: number;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(ymd: string, days: number): string {
  const d = toUtc(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86400_000) + 1;
}

export function isValidYmd(s: unknown): s is string {
  if (typeof s !== "string" || !YMD.test(s)) return false;
  return toUtc(s).toISOString().slice(0, 10) === s;
}

/** "Fri" */
export function weekdayName(ymd: string, style: "short" | "long" = "long"): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: style, timeZone: "UTC" }).format(toUtc(ymd));
}

/** "6 Nov" / "Fri 6 Nov" */
export function shortDate(ymd: string, withWeekday = false): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(withWeekday ? { weekday: "short" as const } : {}),
    timeZone: "UTC",
  }).format(toUtc(ymd));
}

function monthStartOf(ymd: string) {
  return `${ymd.slice(0, 7)}-01`;
}

function lastDayOfMonth(ymd: string) {
  const d = toUtc(monthStartOf(ymd));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function prevMonth(ymd: string) {
  return monthStartOf(addDays(monthStartOf(ymd), -1));
}

/** Monday of the week containing `ymd`. */
function mondayOf(ymd: string) {
  const dow = toUtc(ymd).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7));
}

export function resolveRange(
  input: { range?: string | null; from?: string | null; to?: string | null },
  timeZone: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
): ResolvedRange {
  const today = localDate(now, timeZone);
  const key: RangeKey = (RANGE_KEYS as readonly string[]).includes(input.range ?? "") ? (input.range as RangeKey) : "today";

  let from = today;
  let to = today;
  let compare: DateRange;
  let compareLabel: string;

  switch (key) {
    case "yesterday":
      from = to = addDays(today, -1);
      break;
    case "week":
      from = mondayOf(today);
      break;
    case "month":
      from = monthStartOf(today);
      break;
    case "last_month":
      from = prevMonth(today);
      to = lastDayOfMonth(from);
      break;
    case "custom": {
      const f = isValidYmd(input.from) ? input.from : today;
      const t = isValidYmd(input.to) ? input.to : f;
      from = f <= t ? f : t;
      to = f <= t ? t : f;
      if (to > today) to = today;
      if (from > to) from = to;
      if (daysBetween(from, to) > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
      break;
    }
    default:
      break;
  }

  const days = daysBetween(from, to);
  if (days === 1) {
    // One day: compare with the same weekday last week ("vs last Friday").
    compare = { from: addDays(from, -7), to: addDays(to, -7) };
    compareLabel = `last ${weekdayName(from)}`;
  } else if (key === "month") {
    // Month so far: the same days of last month (1–13 Oct vs 1–13 Nov).
    const pm = prevMonth(from);
    const end = addDays(pm, days - 1);
    compare = { from: pm, to: end > lastDayOfMonth(pm) ? lastDayOfMonth(pm) : end };
    compareLabel = "the same days last month";
  } else if (key === "last_month") {
    const pm = prevMonth(from);
    compare = { from: pm, to: lastDayOfMonth(pm) };
    compareLabel = "the month before";
  } else if (key === "week") {
    compare = { from: addDays(from, -7), to: addDays(to, -7) };
    compareLabel = "the same days last week";
  } else {
    compare = { from: addDays(from, -days), to: addDays(from, -1) };
    compareLabel = `the ${days} days before`;
  }

  const chartFrom = days < 7 ? addDays(to, -6) : from;
  const label =
    key === "custom"
      ? days === 1
        ? shortDate(from, true)
        : `${shortDate(from)} – ${shortDate(to)}`
      : RANGE_LABELS[key];

  return { key, from, to, label, compare, compareLabel, chart: { from: chartFrom, to }, days };
}

/** Percent change, or null when there's nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
