import type { Metadata } from "next";
import { Settings as SettingsIcon } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Restaurant, staff and WhatsApp setup." />
      <EmptyState
        tone="neutral"
        icon={<SettingsIcon />}
        title="Settings coming soon"
        description="Restaurant details, branches, staff, delivery areas and WhatsApp connection will be set up here."
      />
    </>
  );
}
