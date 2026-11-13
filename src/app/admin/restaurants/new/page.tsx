import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { SimplePage } from "@/components/shell/simple-page";
import { SkeletonList } from "@/components/ui/skeleton";
import { requireSuperAdmin } from "@/lib/auth/session";
import { getPlatformSettings, listPlans } from "@/lib/billing/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { NewRestaurantForm } from "./new-restaurant-form";

export const metadata: Metadata = { title: "New restaurant" };

/** Super admin onboards a client: restaurant + first branch + owner login (temporary password). */
async function NewRestaurant() {
  await requireSuperAdmin();
  const db = createAdminClient();
  const [plans, settings] = await Promise.all([listPlans(db), getPlatformSettings(db)]);
  return (
    <SimplePage title="New restaurant" subtitle="Create a restaurant and its owner's login">
      <AdminNav />
      <NewRestaurantForm plans={plans.map((p) => ({ id: p.id, name: p.name }))} defaultTrialDays={settings.defaultTrialDays} />
    </SimplePage>
  );
}

export default function NewRestaurantPage() {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <NewRestaurant />
    </Suspense>
  );
}
