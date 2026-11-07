import type { Metadata } from "next";
import { Suspense } from "react";
import { Bike } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { SimplePage } from "@/components/shell/simple-page";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = { title: "My deliveries" };

/** Rider's mobile page. Placeholder for the riders phase. */
async function Rider() {
  const ctx = await requirePermission("deliveries.view", { onDenied: "redirect" });
  return (
    <SimplePage title="My deliveries" subtitle={ctx.restaurant.name}>
      <EmptyState
        tone="delivery"
        icon={<Bike />}
        title="No deliveries right now"
        description="When the restaurant gives you an order, it will show here with the address and cash to collect."
      />
    </SimplePage>
  );
}

export default function RiderPage() {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <Rider />
    </Suspense>
  );
}
