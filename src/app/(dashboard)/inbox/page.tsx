import type { Metadata } from "next";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shell/page-header";
import { InboxView } from "@/components/inbox/inbox-view";
import { requirePermission } from "@/lib/auth/session";
import { listConversations, listMessages } from "@/lib/whatsapp/queries";

export const metadata: Metadata = { title: "Inbox" };

/**
 * Temporary read-only inbox (Phase 6A). Replies and bot takeover come in
 * Phase 10.
 */
async function Inbox({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const ctx = await requirePermission("inbox.access", { onDenied: "redirect" });
  const { c } = await searchParams;
  const conversations = await listConversations(ctx.restaurant.id);
  const selected = c ? conversations.find((x) => x.id === c) ?? null : null;
  const messages = selected ? await listMessages(ctx.restaurant.id, selected.id) : [];
  return (
    <InboxView
      restaurantId={ctx.restaurant.id}
      timezone={ctx.restaurant.timezone}
      conversations={conversations}
      selected={selected}
      messages={messages}
    />
  );
}

export default function InboxPage({ searchParams }: PageProps<"/inbox">) {
  return (
    <>
      <PageHeader title="Inbox" description="WhatsApp chats with your customers." />
      <Suspense fallback={<SkeletonList />}>
        <Inbox searchParams={searchParams as Promise<{ c?: string }>} />
      </Suspense>
    </>
  );
}
