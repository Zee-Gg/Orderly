import type { Metadata } from "next";
import { Users } from "lucide-react";
import { Suspense } from "react";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <PermissionGate action="customers.view">
        <PageHeader title="Customers" description="People who have ordered from you." />
        <EmptyState
          tone="brand"
          icon={<Users />}
          title="No customers yet"
          description="Customers are saved automatically when they order. You will see their phone, address and past orders here."
        />
      </PermissionGate>
    </Suspense>
  );
}
