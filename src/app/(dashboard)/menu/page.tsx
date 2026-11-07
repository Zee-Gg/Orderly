import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { Suspense } from "react";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Menu" };

export default function MenuPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <PermissionGate action="menu.view">
        <PageHeader title="Menu" description="Your dishes, categories and prices." />
        <EmptyState
          tone="brand"
          icon={<BookOpen />}
          title="No items yet"
          description="Add your dishes, prices and sizes here. Customers will see them on WhatsApp and your menu page."
        />
      </PermissionGate>
    </Suspense>
  );
}
