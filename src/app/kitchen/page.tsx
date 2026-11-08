import type { Metadata } from "next";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getKitchenSnapshot } from "@/lib/kitchen/queries";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { KitchenScreen } from "./kitchen-screen";

export const metadata: Metadata = { title: "Kitchen" };

/** Full-screen kitchen display for a tablet. */
async function Kitchen() {
  const ctx = await requirePermission("kitchen.view", { onDenied: "redirect" });
  const snapshot = await getKitchenSnapshot(ctx);
  return (
    <KitchenScreen
      initial={snapshot}
      restaurantId={ctx.restaurant.id}
      branchName={ctx.currentBranch?.name ?? (ctx.branches.length === 1 ? ctx.branches[0].name : "All branches")}
      timezone={ctx.restaurant.timezone || DEFAULT_TIMEZONE}
      canOpenOrders={can(ctx.role, "orders.view")}
    />
  );
}

export default function KitchenPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-950 p-6"><SkeletonList /></div>}>
      <Kitchen />
    </Suspense>
  );
}
