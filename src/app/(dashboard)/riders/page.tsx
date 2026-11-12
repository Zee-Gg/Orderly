import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getRiders } from "@/lib/riders/queries";
import { RidersManager } from "./riders-manager";

export const metadata: Metadata = { title: "Riders" };

/** Riders (Phase 9): online status, deliveries, cash in hand; add/edit/PIN/settle (owner/manager). */
async function Riders() {
  const ctx = await requirePermission("riders.view", { onDenied: "redirect" });
  const riders = await getRiders(ctx, { includeInactive: true });
  return (
    <>
      <PageHeader title="Riders" description="Your delivery riders, their orders today and the cash they are holding." />
      <RidersManager
        riders={riders}
        branches={ctx.branches.map((b) => ({ id: b.id, name: b.name }))}
        restaurantId={ctx.restaurant.id}
        canManage={can(ctx.role, "riders.manage")}
      />
    </>
  );
}

export default function RidersPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <Riders />
    </Suspense>
  );
}
