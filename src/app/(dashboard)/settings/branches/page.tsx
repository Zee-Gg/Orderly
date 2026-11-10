import type { Metadata } from "next";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { requirePermission } from "@/lib/auth/session";
import { toOpeningHours } from "@/lib/opening-hours";
import { createClient } from "@/lib/supabase/server";
import { BranchesManager, type BranchRow } from "./branches-manager";

export const metadata: Metadata = { title: "Branches" };

async function Branches() {
  const ctx = await requirePermission("branches.manage", { onDenied: "redirect" });
  const supabase = await createClient();
  // RLS limits this to branches the member can access.
  const { data } = await supabase
    .from("branches")
    .select("id, name, address, area, city, phone, is_open, is_active, opening_hours, default_delivery_fee, minimum_order")
    .eq("restaurant_id", ctx.restaurant.id)
    .order("created_at");

  const branches: BranchRow[] = (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    address: b.address ?? "",
    area: b.area ?? "",
    city: b.city ?? "",
    phone: b.phone ?? "",
    isOpen: b.is_open,
    isActive: b.is_active,
    openingHours: toOpeningHours(b.opening_hours),
    deliveryFee: b.default_delivery_fee,
    minimumOrder: b.minimum_order,
  }));

  return (
    <BranchesManager
      branches={branches}
      canAdd={ctx.isRestaurantWide}
      defaultCity={ctx.restaurant.city ?? ""}
    />
  );
}

export default function BranchesPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <Branches />
    </Suspense>
  );
}
