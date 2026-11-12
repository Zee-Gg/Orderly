import { normalize, wordScore } from "@/lib/bot/search";

/**
 * Delivery zones (Phase 9). Pure: match the customer's area text (English,
 * Roman Urdu, misspellings) to a branch's zones by name and other names,
 * check the delivery radius when we have a location pin, and apply the
 * branch's policy for areas that aren't listed. Used by the bot, the staff
 * order screen and the customer menu page. No DB, no Next.js.
 */

export type DeliveryZone = {
  id: string;
  name: string;
  aliases: string[];
  deliveryFee: number; // paisa
  minimumOrder: number; // paisa
  estimatedMinutes: number | null;
  isActive: boolean;
};

export type ZonePolicy = {
  /** Branch delivery fee / minimum used for unlisted areas (policy default_fee) and when no zones exist. */
  defaultFee: number;
  defaultMinimum: number;
  unlistedPolicy: "reject" | "default_fee";
  maxRadiusKm: number | null;
  branchLocation: { latitude: number; longitude: number } | null;
};

export const UNLISTED_AREA_FLAG = "Area not in list — check";

export type ZoneMatch =
  | { kind: "zone"; zone: DeliveryZone; fee: number; minimumOrder: number; etaMinutes: number | null; distanceKm: number | null }
  /** No zone matched; the branch delivers anyway at its default fee (order is flagged), or the branch has no zones. */
  | { kind: "unlisted"; fee: number; minimumOrder: number; flag: string | null; distanceKm: number | null }
  | { kind: "out_of_range"; reason: "radius" | "area_not_served"; distanceKm: number | null };

const NUMBER_WORDS: Record<string, string> = {
  one: "1", ek: "1", aik: "1", two: "2", do: "2", three: "3", teen: "3", four: "4", char: "4", chaar: "4",
  five: "5", paanch: "5", panch: "5", six: "6", chay: "6", chhe: "6", seven: "7", saat: "7", eight: "8", aath: "8",
  nine: "9", nau: "9", ten: "10", das: "10",
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8",
};
const SYNONYMS: Record<string, string> = { ph: "phase", fase: "phase", phse: "phase", blk: "block", sec: "sector", st: "street", gali: "street" };

/** Words of an area name in a comparable form ("DHA Ph-5" → ["dha", "phase", "5"]). */
export function areaTokens(text: string): string[] {
  return normalize(text.replace(/([a-z])(\d)/gi, "$1 $2").replace(/(\d)([a-z])/gi, "$1 $2"))
    .replace(/\./g, " ")
    .split(" ")
    .filter(Boolean)
    .map((t) => SYNONYMS[t] ?? t)
    .map((t) => NUMBER_WORDS[t] ?? t);
}

const isNumber = (t: string) => /^\d+$/.test(t);
const FILLER = new Set(["near", "ke", "ka", "ki", "pass", "paas", "house", "road", "street", "the", "in", "mein", "main", "area", "town", "colony"]);

/**
 * How well one zone name/alias matches the text (0–1). Numbers must match
 * exactly (Phase 5 is not Phase 6); words may be misspelled.
 */
export function nameScore(name: string, text: string): number {
  const want = areaTokens(name).filter((t) => !FILLER.has(t) || isNumber(t));
  const have = areaTokens(text);
  if (!want.length || !have.length) return 0;
  let total = 0;
  for (const w of want) {
    if (isNumber(w)) {
      if (!have.includes(w)) return 0;
      total += 1;
      continue;
    }
    const best = have.filter((h) => !isNumber(h)).reduce((m, h) => Math.max(m, wordScore(w, h)), 0);
    if (best < 0.7) return 0; // every word of the name must be there
    total += best;
  }
  return total / want.length;
}

/** Straight-line distance in km (haversine). */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}

/** The best zone for some area text, or null. Longer (more specific) names win ties. */
export function findZone(zones: DeliveryZone[], text: string): { zone: DeliveryZone; score: number } | null {
  let best: { zone: DeliveryZone; score: number; len: number } | null = null;
  for (const zone of zones.filter((z) => z.isActive)) {
    for (const name of [zone.name, ...zone.aliases]) {
      const score = nameScore(name, text);
      const len = areaTokens(name).length;
      if (score >= 0.8 && (!best || score > best.score + 0.001 || (Math.abs(score - best.score) <= 0.001 && len > best.len))) {
        best = { zone, score, len };
      }
    }
  }
  return best ? { zone: best.zone, score: best.score } : null;
}

/**
 * Where does this address fall? Area text first (zone list), then the radius
 * (when we have a pin, branch coordinates and a max radius), then the policy.
 */
export function matchDeliveryZone(
  zones: DeliveryZone[],
  input: { area?: string | null; address?: string | null; location?: { latitude: number; longitude: number } | null },
  policy: ZonePolicy,
): ZoneMatch {
  const distance = input.location && policy.branchLocation ? distanceKm(policy.branchLocation, input.location) : null;
  if (distance !== null && policy.maxRadiusKm !== null && distance > policy.maxRadiusKm) {
    return { kind: "out_of_range", reason: "radius", distanceKm: distance };
  }
  const active = zones.filter((z) => z.isActive);
  const text = [input.area, input.address].filter(Boolean).join(" , ");
  const found = text ? (input.area ? findZone(active, input.area) : null) ?? findZone(active, text) : null;
  if (found) {
    return {
      kind: "zone",
      zone: found.zone,
      fee: found.zone.deliveryFee,
      minimumOrder: found.zone.minimumOrder,
      etaMinutes: found.zone.estimatedMinutes,
      distanceKm: distance,
    };
  }
  // No zones set up: deliver everywhere at the branch fee, nothing to flag.
  if (!active.length) return { kind: "unlisted", fee: policy.defaultFee, minimumOrder: policy.defaultMinimum, flag: null, distanceKm: distance };
  if (policy.unlistedPolicy === "reject") return { kind: "out_of_range", reason: "area_not_served", distanceKm: distance };
  return { kind: "unlisted", fee: policy.defaultFee, minimumOrder: policy.defaultMinimum, flag: UNLISTED_AREA_FLAG, distanceKm: distance };
}
