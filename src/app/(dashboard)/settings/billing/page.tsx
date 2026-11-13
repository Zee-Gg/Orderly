import type { Metadata } from "next";
import { Suspense } from "react";
import { BillingDetails } from "@/components/billing/billing-details";
import { SkeletonList } from "@/components/ui/skeleton";
import { requirePermission } from "@/lib/auth/session";
import { getBilling, getUsage } from "@/lib/billing/queries";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/time";

export const metadata: Metadata = { title: "Billing" };

/** Owner: plan, status, how to pay, payment history + receipts (Phase 12). */
async function Billing() {
  const ctx = await requirePermission("billing.view", { onDenied: "redirect" });
  const db = await createClient();
  const tz = ctx.restaurant.timezone || DEFAULT_TIMEZONE;
  const [billing, usage] = await Promise.all([getBilling(db, ctx.restaurant.id), getUsage(db, ctx.restaurant.id, tz)]);
  return <BillingDetails billing={billing} usage={usage} timeZone={tz} restaurantName={ctx.restaurant.name} />;
}

export default function BillingPage() {
  return (
    <Suspense fallback={<SkeletonList />}>
      <Billing />
    </Suspense>
  );
}
