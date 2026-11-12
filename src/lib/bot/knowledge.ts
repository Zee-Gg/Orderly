import { normalize, wordScore } from "./search";

/**
 * Pure helpers for what the bot knows besides the menu (Phase 7C):
 * offer schedules, FAQ matching, the "old menu image" check, Google Maps links.
 * No DB, no AI, no Next.js imports.
 */

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export type OfferRecord = {
  id: string;
  branchId: string | null;
  title: string;
  titleUr: string | null;
  description: string | null;
  menuItemId: string;
  imagePath: string | null;
  startsAt: string;
  endsAt: string | null;
  /** ISO weekdays: 1 = Monday … 7 = Sunday. null = every day. */
  daysOfWeek: number[] | null;
  /** "HH:MM" or "HH:MM:SS". Both null = all day. */
  startTime: string | null;
  endTime: string | null;
  isActive: boolean;
  sortOrder: number;
};

const ISO_DAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Day of week (1–7) and minutes since midnight in the restaurant's time zone. */
export function localClock(now: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: ISO_DAY[get("weekday")] ?? 1, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

export type OfferState = "active" | "scheduled" | "expired" | "off";

/**
 * Is the offer on RIGHT NOW? Dates, day of week and time window are checked
 * in the restaurant's time zone. A window like 22:00–02:00 crosses midnight
 * (the early-morning part belongs to the previous day's offer day).
 */
export function offerState(offer: Pick<OfferRecord, "isActive" | "startsAt" | "endsAt" | "daysOfWeek" | "startTime" | "endTime">, now: Date, timeZone: string): OfferState {
  if (!offer.isActive) return "off";
  if (offer.endsAt && Date.parse(offer.endsAt) <= now.getTime()) return "expired";
  if (Date.parse(offer.startsAt) > now.getTime()) return "scheduled";
  const { day, minutes } = localClock(now, timeZone);
  const days = offer.daysOfWeek?.length ? offer.daysOfWeek : null;
  if (!offer.startTime || !offer.endTime) return !days || days.includes(day) ? "active" : "scheduled";
  const start = toMinutes(offer.startTime);
  const end = toMinutes(offer.endTime);
  if (start <= end) return (!days || days.includes(day)) && minutes >= start && minutes < end ? "active" : "scheduled";
  // Crosses midnight: evening part today, or the after-midnight part of yesterday's offer.
  const yesterday = day === 1 ? 7 : day - 1;
  if (minutes >= start && (!days || days.includes(day))) return "active";
  if (minutes < end && (!days || days.includes(yesterday))) return "active";
  return "scheduled";
}

export function isOfferActiveAt(offer: Parameters<typeof offerState>[0], now: Date, timeZone: string) {
  return offerState(offer, now, timeZone) === "active";
}

export const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "Fridays · 12:00–16:00" style text for staff and the bot. */
export function offerScheduleText(offer: Pick<OfferRecord, "daysOfWeek" | "startTime" | "endTime" | "endsAt">): string {
  const days = offer.daysOfWeek?.length ? [...offer.daysOfWeek].sort().map((d) => WEEKDAY_NAMES[d - 1]).join(", ") : "Every day";
  const time = offer.startTime && offer.endTime ? ` · ${offer.startTime.slice(0, 5)}–${offer.endTime.slice(0, 5)}` : "";
  const until = offer.endsAt ? ` · until ${offer.endsAt.slice(0, 10)}` : "";
  return `${days}${time}${until}`;
}

// ---------------------------------------------------------------------------
// FAQs
// ---------------------------------------------------------------------------

export type FaqRecord = {
  id: string;
  question: string;
  answer: string;
  answerUr: string | null;
  keywords: string[];
  isActive: boolean;
  sortOrder: number;
};

// Words that say nothing about the topic.
const FAQ_NOISE = new Set(
  (
    "kya kia ap aap apka aapka ka ki ke ko hai hain ho hota hoti hote mein main me se par pe bhi koi kuch hum is us yeh ye wo " +
    "the a an is are do does you your we our have has can i to of for in on at it any there please plz bhai ji batao bata " +
    "btao sakte sakta sakti milta milti mil available hy h?"
  ).split(" "),
);

function faqTokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .map((t) => t.replace(/[?.!,]/g, ""))
    .filter((t) => t.length >= 2 && !FAQ_NOISE.has(t));
}

const best = (q: string, words: string[]) => words.reduce((m, w) => Math.max(m, wordScore(q, w)), 0);

/**
 * Best matching active FAQs for a customer question (Roman Urdu, English,
 * misspellings). Keywords count most, then the question, then the answer.
 * Returns [] when nothing matches well — the bot must then ask staff.
 */
export function matchFaqs(faqs: FaqRecord[], query: string, limit = 3): { faq: FaqRecord; score: number }[] {
  const words = faqTokens(query);
  if (!words.length) return [];
  const scored = faqs
    .filter((f) => f.isActive && f.answer.trim())
    .map((faq) => {
      const keywords = faq.keywords.flatMap((k) => faqTokens(k));
      const question = faqTokens(faq.question);
      const answer = faqTokens(faq.answer);
      let total = 0;
      for (const w of words) {
        const k = best(w, keywords);
        const q = best(w, question);
        const a = best(w, answer);
        total += Math.max(k >= 0.75 ? 1 : 0, q >= 0.75 ? 0.8 : 0, a >= 0.85 ? 0.35 : 0);
      }
      return { faq, score: Math.round((total / words.length) * 100) / 100 };
    })
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score || a.faq.sortOrder - b.faq.sortOrder);
  return scored.slice(0, limit);
}

/** Ready-made FAQ questions the owner can add with one tap (answers left blank). */
export const FAQ_SUGGESTIONS: { question: string; keywords: string[] }[] = [
  { question: "Parking available?", keywords: ["parking", "car", "gari", "park"] },
  { question: "Family hall?", keywords: ["family", "hall", "families", "ladies"] },
  { question: "Birthday / party arrangements?", keywords: ["birthday", "party", "event", "cake", "booking"] },
  { question: "Is the food halal?", keywords: ["halal", "halaal", "haram"] },
  { question: "Which areas do you deliver to?", keywords: ["delivery", "areas", "area", "deliver"] },
  { question: "How long does home delivery take?", keywords: ["delivery", "time", "kitni", "der", "minute", "long"] },
];

// ---------------------------------------------------------------------------
// Old menu image check
// ---------------------------------------------------------------------------

/** Prices changed after the newest menu image/PDF was uploaded → it may show old prices. */
export function menuImageOutdated(latestUploadAt: string | null, latestPriceChangeAt: string | null): boolean {
  if (!latestUploadAt || !latestPriceChangeAt) return false;
  return Date.parse(latestPriceChangeAt) > Date.parse(latestUploadAt);
}

// ---------------------------------------------------------------------------
// Google Maps links
// ---------------------------------------------------------------------------

const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/**
 * Coordinates from a pasted Google Maps link:
 * ".../@24.8138,67.0299,17z", "?q=24.81,67.02", "!3d24.81!4d67.02", "ll=", "query=", "destination=".
 * Short links (maps.app.goo.gl) must be expanded first (the server follows the redirect).
 */
export function coordinatesFromMapsUrl(url: string): { latitude: number; longitude: number } | null {
  const text = decodeURIComponent(url.trim());
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // place pin (most exact)
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination|center|daddr)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const latitude = Number(m[1]);
      const longitude = Number(m[2]);
      if (valid(latitude, longitude)) return { latitude: Math.round(latitude * 1e6) / 1e6, longitude: Math.round(longitude * 1e6) / 1e6 };
    }
  }
  return null;
}

export function isShortMapsLink(url: string): boolean {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(url.trim());
}

export function mapsLinkFor(latitude: number, longitude: number): string {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}
