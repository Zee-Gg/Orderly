import type { Metadata } from "next";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { requirePermission } from "@/lib/auth/session";
import { RestaurantForm } from "./restaurant-form";

export const metadata: Metadata = { title: "Restaurant settings" };

async function RestaurantSettings() {
  const ctx = await requirePermission("settings.edit", { onDenied: "redirect" });
  const r = ctx.restaurant;
  return (
    <RestaurantForm
      restaurant={{
        id: r.id,
        name: r.name,
        slug: r.slug,
        city: r.city ?? "",
        phone: r.phone ?? "",
        whatsappNumber: r.whatsapp_number ?? "",
        logoUrl: r.logo_url ?? "",
      }}
    />
  );
}

export default function RestaurantSettingsPage() {
  return (
    <Suspense fallback={<SkeletonList count={2} />}>
      <RestaurantSettings />
    </Suspense>
  );
}
