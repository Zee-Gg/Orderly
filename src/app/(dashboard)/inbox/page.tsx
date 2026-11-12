import type { Metadata } from "next";
import { Suspense } from "react";
import { InboxApp } from "@/components/inbox/inbox-app";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getConversationDetail, getInboxSettings, listConversations, listQuickReplies, listStaff, sweepAutoResolve } from "@/lib/inbox/queries";

export const metadata: Metadata = { title: "Inbox" };

/** WhatsApp inbox (Phase 10): reply, take over from the bot, hand back, resolve. Owner/manager/staff only. */
async function Inbox({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const ctx = await requirePermission("inbox.access", { onDenied: "redirect" });
  const { c } = await searchParams;
  // A forgotten takeover never strands a customer: resolve quiet staff chats first.
  await sweepAutoResolve(ctx.restaurant.id);
  const [conversations, staff, settings, quickReplies] = await Promise.all([listConversations(ctx), listStaff(ctx), getInboxSettings(ctx), listQuickReplies(ctx)]);
  const selectedId = typeof c === "string" && /^[0-9a-f-]{36}$/i.test(c) ? c : null;
  const detail = selectedId ? await getConversationDetail(ctx, selectedId, staff) : null;
  return (
    <InboxApp
      restaurantId={ctx.restaurant.id}
      userId={ctx.user.id}
      timezone={ctx.restaurant.timezone}
      initialConversations={conversations}
      initialDetail={detail}
      staff={staff}
      settings={settings}
      quickReplies={quickReplies}
      canReply={can(ctx.role, "inbox.reply")}
      canToggleBot={can(ctx.role, "inbox.bot_toggle")}
    />
  );
}

export default function InboxPage({ searchParams }: PageProps<"/inbox">) {
  return (
    <Suspense fallback={<SkeletonList />}>
      <Inbox searchParams={searchParams as Promise<{ c?: string | string[] }>} />
    </Suspense>
  );
}
