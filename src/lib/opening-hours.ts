import { z } from "zod";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 12:00");

const dayHoursSchema = z.discriminatedUnion("closed", [
  z.object({ closed: z.literal(true) }),
  z
    .object({ closed: z.literal(false), open: time, close: time })
    .refine((d) => d.open !== d.close, {
      message: "Opening and closing time can't be the same",
      path: ["close"],
    }),
]);

/**
 * Same shape the database checks (private.is_valid_opening_hours).
 * A close time earlier than open means closing after midnight (12:00 → 02:00).
 */
export const openingHoursSchema = z.object(
  Object.fromEntries(WEEKDAYS.map((d) => [d, dayHoursSchema])) as Record<
    Weekday,
    typeof dayHoursSchema
  >,
);

export type DayHours = z.infer<typeof dayHoursSchema>;
export type OpeningHours = z.infer<typeof openingHoursSchema>;

export const DEFAULT_OPENING_HOURS: OpeningHours = Object.fromEntries(
  WEEKDAYS.map((d) => [d, { closed: false, open: "12:00", close: "00:00" }]),
) as OpeningHours;

/** "14:30" → "2:30 PM" */
export function formatTime(value: string): string {
  const [h, m] = value.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${period}` : `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatDayHours(day: DayHours): string {
  if (day.closed) return "Closed";
  const overnight = day.close < day.open;
  return `${formatTime(day.open)} – ${formatTime(day.close)}${overnight ? " (next day)" : ""}`;
}

/** Short summary for lists: "Every day 12 PM – 2 AM (next day)" or "Varies by day". */
export function summarizeOpeningHours(value: unknown): string {
  const parsed = openingHoursSchema.safeParse(value);
  if (!parsed.success) return "Hours not set";
  const days = WEEKDAYS.map((d) => formatDayHours(parsed.data[d]));
  if (days.every((d) => d === days[0])) return `Every day · ${days[0]}`;
  const closed = WEEKDAYS.filter((d) => parsed.data[d].closed);
  const open = days.filter((d) => d !== "Closed");
  if (open.length && open.every((d) => d === open[0])) {
    return `${open[0]} · closed ${closed.map((d) => WEEKDAY_LABELS[d].slice(0, 3)).join(", ")}`;
  }
  return "Varies by day";
}

/** Parse DB jsonb into OpeningHours, falling back to defaults. */
export function toOpeningHours(value: unknown): OpeningHours {
  const parsed = openingHoursSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_OPENING_HOURS;
}

const WEEKDAY_FROM_INTL: Record<string, Weekday> = {
  Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun",
};

function toMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Is a time inside the opening hours, in the restaurant's timezone?
 * Handles closing after midnight (12:00 → 02:00 is open at 01:00 the next day).
 */
export function isOpenAt(hours: OpeningHours, date: Date, timeZone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const today = WEEKDAY_FROM_INTL[get("weekday")];
  if (!today) return false;
  const now = Number(get("hour")) * 60 + Number(get("minute"));
  const yesterday = WEEKDAYS[(WEEKDAYS.indexOf(today) + 6) % 7];

  const t = hours[today];
  if (!t.closed) {
    const open = toMinutes(t.open);
    const close = toMinutes(t.close);
    if (close > open ? now >= open && now < close : now >= open) return true;
  }
  const y = hours[yesterday];
  if (!y.closed) {
    const open = toMinutes(y.open);
    const close = toMinutes(y.close);
    if (close < open && now < close) return true;
  }
  return false;
}

/** Day of the week ("mon"…"sun") at `date` in the restaurant's time zone. */
export function weekdayAt(date: Date, timeZone: string): (typeof WEEKDAYS)[number] {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  return WEEKDAY_FROM_INTL[name] ?? "mon";
}
