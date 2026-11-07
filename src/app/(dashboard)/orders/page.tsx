import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { Suspense } from "react";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <PermissionGate action="orders.view">
        <PageHeader title="Orders" description="New, preparing, ready and out-for-delivery orders." />
        <EmptyState
          tone="brand"
          icon={<ClipboardList />}
          title="No orders yet today"
          description="When customers order on WhatsApp, their orders will show here — with a sound."
        />
      </PermissionGate>
    </Suspense>
  );
}
