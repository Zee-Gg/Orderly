import { matchDeliveryZone } from "@/lib/delivery/zones";
import { invalidateSummary } from "./cart";
import type { BotSession, BranchInfo, SessionZone } from "./types";
import type { BotContext } from "./tools/context";

/**
 * Delivery zones in the chat (Phase 9). CODE decides the fee and minimum from
 * the customer's area / pin (src/lib/delivery/zones.ts); the summary uses
 * them. No Next.js imports.
 */

/** Fee + minimum for this chat: the matched zone, else the branch defaults. */
export function deliveryTerms(session: BotSession, branch: Pick<BranchInfo, "deliveryFee" | "minimumOrder">): { fee: number; minimumOrder: number } {
  if (session.orderType !== "delivery") return { fee: 0, minimumOrder: 0 };
  const z = session.deliveryZone;
  if (z && z.status !== "out_of_range") return { fee: z.fee, minimumOrder: z.minimumOrder };
  return { fee: branch.deliveryFee, minimumOrder: branch.minimumOrder };
}

/** Match the session's address/pin to the branch's zones and remember it. */
export async function applyDeliveryZone(ctx: BotContext): Promise<SessionZone | null> {
  const s = ctx.session;
  const a = s.address;
  if (!a.text && !a.area && a.latitude == null) {
    s.deliveryZone = null;
    return null;
  }
  const zones = await ctx.store.getDeliveryZones(s.restaurantId, s.branchId);
  const b = ctx.branch;
  const match = matchDeliveryZone(
    zones,
    { area: a.area, address: a.text, location: a.latitude != null && a.longitude != null ? { latitude: a.latitude, longitude: a.longitude } : null },
    {
      defaultFee: b.deliveryFee,
      defaultMinimum: b.minimumOrder,
      unlistedPolicy: b.unlistedAreaPolicy,
      maxRadiusKm: b.maxDeliveryRadiusKm,
      branchLocation: b.latitude != null && b.longitude != null ? { latitude: b.latitude, longitude: b.longitude } : null,
    },
  );
  const zone: SessionZone =
    match.kind === "zone"
      ? { status: "zone", zoneId: match.zone.id, name: match.zone.name, fee: match.fee, minimumOrder: match.minimumOrder, etaMinutes: match.etaMinutes, flag: null }
      : match.kind === "unlisted"
        ? { status: "unlisted", zoneId: null, name: null, fee: match.fee, minimumOrder: match.minimumOrder, etaMinutes: null, flag: match.flag }
        : { status: "out_of_range", zoneId: null, name: null, fee: 0, minimumOrder: 0, etaMinutes: null, flag: null };
  const changed = JSON.stringify(zone) !== JSON.stringify(s.deliveryZone);
  s.deliveryZone = zone;
  if (changed) invalidateSummary(s);
  return zone;
}
