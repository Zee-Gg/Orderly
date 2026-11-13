import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Ban, Phone } from "lucide-react";
import { BillingDetails } from "@/components/billing/billing-details";
import { SimplePage } from "@/components/shell/simple-page";
import { SkeletonList } from "@/components/ui/skeleton";
import { can } from "@/lib/auth/permissions";
import { requireMembership } from "@/lib/auth/session";
import { getBilling, getPlatformSettings } from "@/lib/billing/queries";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/time";

export const metadata: Metadata = { title: "Account suspended" };

/**
 * What staff see while the restaurant is suspended (unpaid). Owners also see
 * billing (how to pay + history). Nothing is deleted; paying turns it back on.
 */
async function Suspended() {
  const ctx = await requireMembership();
  if (ctx.restaurant.status !== "suspended") redirect("/auth/continue");
  const db = await createClient();
  const tz = ctx.restaurant.timezone || DEFAULT_TIMEZONE;
  const isOwner = can(ctx.role, "billing.view");
  const [billing, settings] = await Promise.all([isOwner ? getBilling(db, ctx.restaurant.id) : null, getPlatformSettings(db)]);

  return (
    <SimplePage title={ctx.restaurant.name} subtitle="Account suspended">
      <div className="flex max-w-3xl flex-col gap-4">
        <div className="flex gap-4 rounded-card border border-status-cancelled-border bg-status-cancelled-bg p-4 text-status-cancelled-fg" data-testid="suspended-notice">
          <Ban aria-hidden className="mt-1 size-6 shrink-0" />
          <div>
            <h2 className="text-lg font-bold">Account suspended — contact us</h2>
            <p>
              Online ordering is switched off because the subscription is unpaid. Your menu, orders and customers are safe — nothing is deleted.
              {isOwner ? " Pay using the details below and send us the receipt." : " Please tell the owner."}
            </p>
            {settings.supportPhone ? (
              <a href={`tel:${settings.supportPhone}`} className="mt-2 inline-flex min-h-touch items-center gap-2 font-semibold underline">
                <Phone aria-hidden className="size-4" /> {settings.supportPhone}
              </a>
            ) : null}
          </div>
        </div>
        {billing ? <BillingDetails billing={billing} usage={null} timeZone={tz} restaurantName={ctx.restaurant.name} /> : null}
      </div>
    </SimplePage>
  );
}

export default function SuspendedPage() {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <Suspended />
    </Suspense>
  );
}
