import type { Metadata } from "next";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DeliverySettings, type BranchDelivery } from "./delivery-settings";

export const metadata: Metadata = { title: "Delivery areas" };

/** Phase 9: delivery zones per branch (fee, minimum, time, other names), radius, unlisted-area rule. */
async function Delivery() {
  const ctx = await requirePermission("delivery.manage", { onDenied: "redirect" });
  const db = await createClient();
  const ids = ctx.branches.map((b) => b.id);
  const [branches, zones, restaurant] = await Promise.all([
    db.from("branches").select("id, name, default_delivery_fee, minimum_order, max_delivery_radius_km, unlisted_area_policy, latitude, longitude").in("id", ids).order("created_at"),
    db.from("delivery_zones").select("*").eq("restaurant_id", ctx.restaurant.id).in("branch_id", ids).order("sort_order").order("created_at"),
    db.from("restaurants").select("share_rider_phone_with_customer").eq("id", ctx.restaurant.id).single(),
  ]);
  const data: BranchDelivery[] = (branches.data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    defaultFee: b.default_delivery_fee,
    defaultMinimum: b.minimum_order,
    maxRadiusKm: b.max_delivery_radius_km,
    unlistedPolicy: b.unlisted_area_policy === "reject" ? "reject" : "default_fee",
    hasPin: b.latitude != null && b.longitude != null,
    zones: (zones.data ?? [])
      .filter((z) => z.branch_id === b.id)
      .map((z) => ({
        id: z.id,
        name: z.name,
        aliases: z.aliases,
        deliveryFee: z.delivery_fee,
        minimumOrder: z.minimum_order,
        estimatedMinutes: z.estimated_minutes,
        isActive: z.is_active,
      })),
  }));
  return (
    <DeliverySettings
      branches={data}
      shareRiderPhone={restaurant.data?.share_rider_phone_with_customer ?? false}
      canEditRestaurant={can(ctx.role, "settings.edit")}
    />
  );
}

export default function DeliveryPage() {
  return (
    <Suspense fallback={<SkeletonList count={3} />}>
      <Delivery />
    </Suspense>
  );
}
