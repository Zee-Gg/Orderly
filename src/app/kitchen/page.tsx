import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Flame } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { SimplePage } from "@/components/shell/simple-page";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Kitchen" };

/** Full-screen kitchen display (tablet). Placeholder for a later phase. */
async function Kitchen() {
  const ctx = await requirePermission("kitchen.view", { onDenied: "redirect" });
  return (
    <SimplePage
      title="Kitchen"
      subtitle={`${ctx.restaurant.name}${ctx.currentBranch ? ` · ${ctx.currentBranch.name}` : ""}`}
      actions={
        can(ctx.role, "orders.view") ? (
          <Link href="/orders" className={buttonVariants({ variant: "secondary" })}>
            <ArrowLeft aria-hidden />
            Orders
          </Link>
        ) : null
      }
    >
      <EmptyState
        icon={<Flame />}
        title="No orders to cook"
        description="Accepted orders will appear here in big cards for the cooks, with one tap to mark them ready."
        className="flex-1 justify-center"
      />
    </SimplePage>
  );
}

export default function KitchenPage() {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <Kitchen />
    </Suspense>
  );
}
