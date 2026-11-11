/**
 * Timezone helpers. "Today" always means today in the restaurant's timezone
 * (default Asia/Karachi), never UTC — 1 AM in Lahore is still "yesterday" in UTC.
 */
export const DEFAULT_TIMEZONE = "Asia/Karachi";

/** Offset of `timeZone` from UTC at `date`, in milliseconds (Karachi: +5h). */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Calendar date (YYYY-MM-DD) of `date` in `timeZone`. */
export function localDate(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** UTC instant of local midnight for a YYYY-MM-DD date in `timeZone`. */
export function startOfLocalDay(ymd: string, timeZone: string = DEFAULT_TIMEZONE): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const offset = timeZoneOffsetMs(guess, timeZone);
  const first = new Date(guess.getTime() - offset);
  // Re-check in case midnight falls across a DST change.
  const offset2 = timeZoneOffsetMs(first, timeZone);
  return offset2 === offset ? first : new Date(guess.getTime() - offset2);
}

/** [start, end) of "today" in `timeZone`, as UTC Dates. */
export function todayRange(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()) {
  const ymd = localDate(now, timeZone);
  const start = startOfLocalDay(ymd, timeZone);
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { start, end: startOfLocalDay(next, timeZone), ymd };
}

/** Start of this month in the restaurant's time zone (AI budget, usage). */
export function monthStart(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): Date {
  return startOfLocalDay(`${localDate(now, timeZone).slice(0, 7)}-01`, timeZone);
}

/** [start, end) for an inclusive local date range "from"–"to" (YYYY-MM-DD). */
export function localDateRange(from: string, to: string, timeZone: string = DEFAULT_TIMEZONE) {
  const [y, m, d] = to.split("-").map(Number);
  const after = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { start: startOfLocalDay(from, timeZone), end: startOfLocalDay(after, timeZone) };
}

/** "Just now", "4 min ago", "2 hr ago", "3 days ago". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} day${hours >= 48 ? "s" : ""} ago`;
}

/** Minutes since `iso`. */
export function minutesSince(iso: string, now: number = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / 60000);
}

/** "7:45 PM" in the restaurant's timezone. */
export function formatClock(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-PK", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

/** "Fri 6 Nov, 7:45 PM" in the restaurant's timezone. */
export function formatDateTime(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-PK", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}
