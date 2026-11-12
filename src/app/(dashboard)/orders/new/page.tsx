import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderComposer, type ComposerZones } from "@/components/orders/composer/order-composer";
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
  const db = await createClient();
  const branchIds = ctx.branches.map((b) => b.id);
  const [menu, zoneRows, branchRows] = await Promise.all([
    getBranchMenu(db, ctx.restaurant.id, branch.id),
    db.from("delivery_zones").select("id, branch_id, name, aliases, delivery_fee, minimum_order").in("branch_id", branchIds).eq("is_active", true).order("sort_order"),
    db.from("branches").select("id, default_delivery_fee").in("id", branchIds),
  ]);
  const zones: ComposerZones = Object.fromEntries(
    (branchRows.data ?? []).map((b) => [
      b.id,
      {
        defaultFee: b.default_delivery_fee,
        zones: (zoneRows.data ?? [])
          .filter((z) => z.branch_id === b.id)
          .map((z) => ({ id: z.id, name: z.name, aliases: z.aliases, deliveryFee: z.delivery_fee, minimumOrder: z.minimum_order })),
      },
    ]),
  );
  return (
    <OrderComposer
      branches={ctx.branches.map((b) => ({ id: b.id, name: b.name }))}
      initialBranchId={branch.id}
      initialMenu={menu}
      canDiscount={can(ctx.role, "orders.discount")}
      canOverrideBlock={can(ctx.role, "orders.override_block")}
      zones={zones}
      canChangeFee={can(ctx.role, "orders.delivery_fee")}
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
