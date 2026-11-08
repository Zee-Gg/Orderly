import { formatPhone, normalizePhone } from "@/lib/orders/phone";
import {
  formatDayHours,
  isOpenAt,
  openingHoursSchema,
  WEEKDAY_LABELS,
  WEEKDAYS,
} from "@/lib/opening-hours";
import type { GreetingContext } from "./store";

/**
 * Temporary automatic greeting (until the AI bot in Phase 7).
 * Roman Urdu first, then English. Plain text: WhatsApp renders *bold*.
 */
export function isRestaurantOpen(ctx: GreetingContext, now: Date): boolean {
  if (!ctx.branchIsOpen) return false;
  const hours = openingHoursSchema.safeParse(ctx.openingHours);
  // No hours saved: trust the "open" switch alone.
  return hours.success ? isOpenAt(hours.data, now, ctx.timezone) : true;
}

export function hoursText(openingHours: unknown): string | null {
  const parsed = openingHoursSchema.safeParse(openingHours);
  if (!parsed.success) return null;
  const lines = WEEKDAYS.map((d) => formatDayHours(parsed.data[d]));
  if (lines.every((l) => l === lines[0])) return `Every day: ${lines[0]}`;
  return WEEKDAYS.map((d, i) => `${WEEKDAY_LABELS[d].slice(0, 3)}: ${lines[i]}`).join("\n");
}

export function buildGreeting(ctx: GreetingContext, now: Date): string {
  const name = ctx.restaurantName;
  const phone = ctx.phone ? formatPhone(normalizePhone(ctx.phone) ?? ctx.phone) : null;
  const welcome = `Assalam o Alaikum! *${name}* mein khush aamdeed 🍕`;

  if (!isRestaurantOpen(ctx, now)) {
    const hours = hoursText(ctx.openingHours);
    return [
      welcome,
      "",
      "Maazrat, hum abhi band hain.",
      "Sorry, we're closed right now.",
      ...(hours ? ["", "*Opening hours:*", hours] : []),
      ...(phone ? ["", `Order ke liye khulne par call karein / Call us when we open: ${phone}`] : []),
    ].join("\n");
  }

  return [
    welcome,
    "",
    phone
      ? `Hamara AI order assistant jald aa raha hai. Abhi order ke liye call karein: ${phone}.`
      : "Hamara AI order assistant jald aa raha hai. Abhi order ke liye restaurant se rabta karein.",
    "",
    phone
      ? `Welcome to ${name}! Our AI order assistant is coming soon. To order now, please call ${phone}.`
      : `Welcome to ${name}! Our AI order assistant is coming soon. Please contact the restaurant to order.`,
  ].join("\n");
}
