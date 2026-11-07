import type { Metadata } from "next";
import { Suspense } from "react";
import { PermissionGate } from "@/components/auth/permission-gate";
import { SkeletonList } from "@/components/ui/skeleton";
import { OrdersScreen } from "./orders-screen";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <PermissionGate action="orders.view">
        <OrdersScreen />
      </PermissionGate>
    </Suspense>
  );
}
