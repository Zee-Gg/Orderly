import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderComposer, type ComposerPrefill, type ComposerZones } from "@/components/orders/composer/order-composer";
import { Alert } from "@/components/ui/alert";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import type { CartLine } from "@/lib/bot/types";
import { getBranchMenu } from "@/lib/menu/pricing";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New order" };

type Search = { phone?: string; name?: string; cart?: string };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const UUID = /^[0-9a-f-]{36}$/i;

async function NewOrder({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("orders.create", { onDenied: "redirect" });
  const sp = await searchParams;
  const q: Search = { phone: one(sp.phone), name: one(sp.name), cart: one(sp.cart) };
  const db = await createClient();

  // Phase 10: "Create order from this cart" (inbox) — the bot session's cart, read with RLS.
  let prefill: ComposerPrefill | undefined;
  let sessionBranch: string | null = null;
  if (q.cart && UUID.test(q.cart)) {
    const { data: session } = await db
      .from("bot_sessions")
      .select("branch_id, cart, order_type, delivery_address_text, delivery_area, delivery_landmark, payment_method")
      .eq("id", q.cart)
      .eq("restaurant_id", ctx.restaurant.id)
      .maybeSingle();
    if (session) {
      const cart = (Array.isArray(session.cart) ? session.cart : []) as unknown as CartLine[];
      sessionBranch = ctx.branches.some((b) => b.id === session.branch_id) ? session.branch_id : null;
      prefill = {
        orderType: (session.order_type as "delivery" | "pickup" | null) ?? undefined,
        addressText: session.delivery_address_text ?? undefined,
        area: session.delivery_area ?? undefined,
        landmark: session.delivery_landmark ?? undefined,
        paymentMethod: (session.payment_method as "cod" | "card_on_delivery" | null) ?? undefined,
        lines: cart.map((l) => ({ itemId: l.itemId, variantId: l.variantId, optionIds: l.optionIds, removals: l.removals, quantity: l.quantity, notes: l.notes })),
      };
    }
  }
  if (q.phone) prefill = { ...prefill, customerPhone: q.phone.slice(0, 20), customerName: q.name?.slice(0, 120) };

  const branch = ctx.branches.find((b) => b.id === sessionBranch) ?? ctx.currentBranch ?? ctx.branches[0];
  if (!branch) return <Alert>Add a branch first (Settings → Branches).</Alert>;
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
      prefill={prefill}
    />
  );
}

export default function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  return (
    <Suspense fallback={<SkeletonList />}>
      <NewOrder searchParams={searchParams} />
    </Suspense>
  );
}
