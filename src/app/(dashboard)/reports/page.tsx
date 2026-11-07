import type { Metadata } from "next";
import { ChartColumn } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" description="Sales and orders over time." />
      <EmptyState
        tone="brand"
        icon={<ChartColumn />}
        title="No sales yet"
        description="Daily sales, top dishes and busy hours will show here once orders start coming in."
      />
    </>
  );
}
