import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Menu" };

export default function MenuPage() {
  return (
    <>
      <PageHeader title="Menu" description="Your dishes, categories and prices." />
      <EmptyState
        tone="brand"
        icon={<BookOpen />}
        title="No items yet"
        description="Add your dishes, prices and sizes here. Customers will see them on WhatsApp and your menu page."
      />
    </>
  );
}
