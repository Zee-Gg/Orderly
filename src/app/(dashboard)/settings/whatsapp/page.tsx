import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckCircle2, MessageCircle, XCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "WhatsApp" };

/** Read-only for owners/managers. Only the platform admin connects numbers. */
async function WhatsAppSettings() {
  const ctx = await requirePermission("settings.view", { onDenied: "redirect" });
  // User client: RLS + column grants (the token column is never readable).
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("whatsapp_accounts")
    .select("display_phone_number, is_active, connected_at, branch_id")
    .eq("restaurant_id", ctx.restaurant.id)
    .maybeSingle();

  if (!account) {
    return (
      <EmptyState
        tone="brand"
        icon={<MessageCircle />}
        title="WhatsApp is not connected yet"
        description="Contact Orderly support to connect your WhatsApp Business number. Customers can then message you to order."
      />
    );
  }

  const branch = ctx.branches.find((b) => b.id === account.branch_id);
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card padding="lg" className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <MessageCircle aria-hidden className="size-6 text-whatsapp" />
          <p className="flex-1 text-lg font-bold">{account.display_phone_number}</p>
          {account.is_active ? (
            <Badge tone="ready" icon={<CheckCircle2 />}>Connected</Badge>
          ) : (
            <Badge tone="cancelled" icon={<XCircle />}>Off</Badge>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">WhatsApp orders go to</dt>
          <dd className="font-semibold">{branch?.name ?? "Your first branch"}</dd>
          <dt className="text-muted">Connected on</dt>
          <dd>{formatDateTime(account.connected_at, ctx.restaurant.timezone)}</dd>
        </dl>
      </Card>
      <Alert tone="info" title="Automatic greeting">
        Right now customers who message this number get a short welcome reply (once every 6 hours) with your phone number,
        or your opening hours when you are closed. Ordering by chat comes soon. See all chats in Inbox.
      </Alert>
    </div>
  );
}

export default function WhatsAppSettingsPage() {
  return (
    <Suspense fallback={<SkeletonList count={2} />}>
      <WhatsAppSettings />
    </Suspense>
  );
}
