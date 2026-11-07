import type { Metadata } from "next";
import { Bike } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Riders" };

export default function RidersPage() {
  return (
    <>
      <PageHeader title="Riders" description="Delivery riders and their orders." />
      <EmptyState
        tone="delivery"
        icon={<Bike />}
        title="No riders added"
        description="Add your riders with their phone number. They get a simple page to see orders and cash to collect."
      />
    </>
  );
}
