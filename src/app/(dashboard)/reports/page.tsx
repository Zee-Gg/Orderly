import type { Metadata } from "next";
import { ChartColumn } from "lucide-react";
import { Suspense } from "react";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <PermissionGate action="reports.view">
        <PageHeader title="Reports" description="Sales and orders over time." />
        <EmptyState
          tone="brand"
          icon={<ChartColumn />}
          title="No sales yet"
          description="Daily sales, top dishes and busy hours will show here once orders start coming in."
        />
      </PermissionGate>
    </Suspense>
  );
}
