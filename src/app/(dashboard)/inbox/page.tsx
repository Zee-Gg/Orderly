import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage() {
  return (
    <>
      <PageHeader title="Inbox" description="WhatsApp chats with your customers." />
      <EmptyState
        tone="brand"
        icon={<MessageCircle />}
        title="No chats yet"
        description="WhatsApp conversations with customers will show here. You can take over from the bot any time."
      />
    </>
  );
}
