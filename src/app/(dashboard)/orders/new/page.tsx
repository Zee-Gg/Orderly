import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderComposer } from "@/components/orders/composer/order-composer";
import { Alert } from "@/components/ui/alert";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getBranchMenu } from "@/lib/menu/pricing";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New order" };

async function NewOrder() {
  const ctx = await requirePermission("orders.create", { onDenied: "redirect" });
  const branch = ctx.currentBranch ?? ctx.branches[0];
  if (!branch) return <Alert>Add a branch first (Settings → Branches).</Alert>;
  const menu = await getBranchMenu(await createClient(), ctx.restaurant.id, branch.id);
  return (
    <OrderComposer
      branches={ctx.branches.map((b) => ({ id: b.id, name: b.name }))}
      initialBranchId={branch.id}
      initialMenu={menu}
      canDiscount={can(ctx.role, "orders.discount")}
      canOverrideBlock={can(ctx.role, "orders.override_block")}
    />
  );
}

export default function NewOrderPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <NewOrder />
    </Suspense>
  );
}
