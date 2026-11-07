import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getCustomer } from "@/lib/orders/queries";
import { CustomerProfile } from "./customer-profile";

export const metadata: Metadata = { title: "Customer" };

async function Customer({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("customers.view", { onDenied: "redirect" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getCustomer(ctx, id);
  if (!data) notFound();
  const c = data.customer;
  return (
    <CustomerProfile
      timezone={data.timezone}
      canEdit={can(ctx.role, "customers.edit")}
      canBlock={can(ctx.role, "customers.block")}
      customer={{
        id: c.id,
        name: c.name,
        phone: c.phone,
        notes: c.notes ?? "",
        tags: c.tags,
        isBlocked: c.is_blocked,
        blockedReason: c.blocked_reason,
        totalOrders: c.total_orders,
        totalSpent: Number(c.total_spent),
        cancelledCount: c.cancelled_count,
        refusedCount: c.refused_count,
        lastOrderAt: c.last_order_at,
        createdAt: c.created_at,
        addresses: c.addresses.map((a) => ({
          id: a.id,
          label: a.label,
          addressText: a.address_text,
          area: a.area,
          landmark: a.landmark,
          isDefault: a.is_default,
        })),
      }}
      orders={data.orders.map((o) => ({
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        orderType: o.order_type,
        total: o.total,
        createdAt: o.created_at,
        branchName: o.branch?.name ?? "",
      }))}
    />
  );
}

export default function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  return (
    <Suspense fallback={<SkeletonList />}>
      <Customer params={params} />
    </Suspense>
  );
}
