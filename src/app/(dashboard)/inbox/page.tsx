import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { Suspense } from "react";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <PermissionGate action="inbox.access">
        <PageHeader title="Inbox" description="WhatsApp chats with your customers." />
        <EmptyState
          tone="brand"
          icon={<MessageCircle />}
          title="No chats yet"
          description="WhatsApp conversations with customers will show here. You can take over from the bot any time."
        />
      </PermissionGate>
    </Suspense>
  );
}
