import type { Metadata } from "next";
import { Suspense } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getInboxSettings, listQuickReplies } from "@/lib/inbox/queries";
import { QuickRepliesManager } from "./quick-replies-manager";

export const metadata: Metadata = { title: "Quick replies" };

/** Phase 10: saved replies staff insert in the inbox with "/" + inbox timings. */
async function QuickReplies() {
  const ctx = await requirePermission("inbox.quick_replies", { onDenied: "redirect" });
  const [replies, settings] = await Promise.all([listQuickReplies(ctx), getInboxSettings(ctx)]);
  return <QuickRepliesManager replies={replies} settings={settings} canEditTimings={can(ctx.role, "settings.edit")} />;
}

export default function QuickRepliesPage() {
  return (
    <Suspense fallback={<SkeletonList count={4} />}>
      <QuickReplies />
    </Suspense>
  );
}
