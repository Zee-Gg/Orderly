import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <>
      <PageHeader title="Orders" description="New, preparing, ready and out-for-delivery orders." />
      <EmptyState
        tone="brand"
        icon={<ClipboardList />}
        title="No orders yet today"
        description="When customers order on WhatsApp, their orders will show here — with a sound."
      />
    </>
  );
}
