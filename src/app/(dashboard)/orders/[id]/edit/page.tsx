import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { OrderComposer } from "@/components/orders/composer/order-composer";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getBranchMenu } from "@/lib/menu/pricing";
import { getOrderDetail } from "@/lib/orders/queries";
import { canEdit } from "@/lib/orders/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit order" };

async function EditOrder({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("orders.edit", { onDenied: "redirect" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const order = await getOrderDetail(ctx, id);
  if (!order) notFound();

  const check = canEdit(order.status, ctx.role);
  if (!check.ok) {
    return (
      <div className="flex flex-col gap-4">
        <Alert title={`Order #${order.order_number} can't be edited`}>{check.message}</Alert>
        <Link href={`/orders?order=${order.id}`} className={buttonVariants({ variant: "secondary", className: "self-start" })}>
          Back to order
        </Link>
      </div>
    );
  }

  const menu = await getBranchMenu(await createClient(), ctx.restaurant.id, order.branch_id);
  return (
    <OrderComposer
      branches={[{ id: order.branch_id, name: order.branch?.name ?? "Branch" }]}
      initialBranchId={order.branch_id}
      initialMenu={menu}
      canDiscount={can(ctx.role, "orders.discount")}
      canOverrideBlock={false}
      editOrder={{
        id: order.id,
        version: order.version,
        orderNumber: order.order_number,
        status: order.status,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        orderType: order.order_type,
        paymentMethod: order.payment_method,
        addressText: order.address_text ?? "",
        area: order.area ?? "",
        landmark: order.landmark ?? "",
        tableNumber: order.table_number ?? "",
        notes: order.notes ?? "",
        deliveryFee: order.delivery_fee,
        discount: order.discount,
        lines: order.items.map((i) => ({
          itemId: i.item_id,
          variantId: i.variant_id,
          optionIds: i.modifiers.map((m) => m.option_id).filter((x): x is string => !!x),
          removals: i.removals,
          quantity: i.quantity,
          notes: i.notes ?? "",
        })),
      }}
    />
  );
}

export default function EditOrderPage({ params }: PageProps<"/orders/[id]/edit">) {
  return (
    <Suspense fallback={<SkeletonList />}>
      <EditOrder params={params} />
    </Suspense>
  );
}
