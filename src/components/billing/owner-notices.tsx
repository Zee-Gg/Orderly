import Link from "next/link";
import { CircleAlert, Clock, ListChecks, TriangleAlert } from "lucide-react";
import type { CurrentContext } from "@/lib/auth/session";
import { billingBanner, limitWarnings } from "@/lib/billing/core";
import { getBilling, getUsage } from "@/lib/billing/queries";
import { getOnboardingChecklist } from "@/lib/onboarding/checklist";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * Owner-only notices at the top of the dashboard (Phase 12): trial ending /
 * payment due, plan limits passed, and setup progress until it's complete.
 * Never blocks anything; failures render nothing.
 */
export async function OwnerNotices({ ctx }: { ctx: CurrentContext }) {
  if (ctx.role !== "owner") return null;
  const data = await loadNotices(ctx);
  if (!data) return null;
  const { banner, limits, checklist } = data;
  if (!banner && !limits.length && checklist.complete) return null;

  return (
    <div className="flex flex-col gap-2" data-testid="owner-notices">
      {banner ? (
        <Link
          href="/settings/billing"
          className={cn(
            "flex items-start gap-3 rounded-card border px-4 py-3 text-sm",
            banner.tone === "danger" &&
              "border-status-cancelled-border bg-status-cancelled-bg text-status-cancelled-fg",
            banner.tone === "warning" &&
              "border-status-awaiting-border bg-status-awaiting-bg text-status-awaiting-fg",
            banner.tone === "info" &&
              "border-status-accepted-border bg-status-accepted-bg text-status-accepted-fg",
          )}
          data-testid="billing-banner"
        >
          {banner.tone === "danger" ? (
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          ) : (
            <Clock aria-hidden className="mt-0.5 size-5 shrink-0" />
          )}
          <span>
            <strong>{banner.title}.</strong> {banner.body}{" "}
            <span className="underline">See billing</span>
          </span>
        </Link>
      ) : null}
      {limits.length ? (
        <Link
          href="/settings/billing"
          className="flex items-start gap-3 rounded-card border border-status-awaiting-border bg-status-awaiting-bg px-4 py-3 text-sm text-status-awaiting-fg"
          data-testid="limit-warning"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <span>
            <strong>You are over your plan.</strong>{" "}
            {limits.map((l) => l.text).join(" · ")}. Orders still work — please
            talk to us about a bigger plan.
          </span>
        </Link>
      ) : null}
      {!checklist.complete ? (
        <Link
          href="/settings/setup"
          className="flex items-center gap-3 rounded-card border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800"
          data-testid="setup-progress"
        >
          <ListChecks aria-hidden className="size-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <strong>Finish setting up:</strong> {checklist.done} of{" "}
            {checklist.total} steps done
            <span
              className="mt-1 block h-2 overflow-hidden rounded-full bg-white"
              aria-hidden
            >
              <span
                className="block h-full rounded-full bg-brand-700"
                style={{
                  width: `${(checklist.done / checklist.total) * 100}%`,
                }}
              />
            </span>
          </span>
          <span className="shrink-0 font-semibold underline">Open</span>
        </Link>
      ) : null}
    </div>
  );
}

async function loadNotices(ctx: CurrentContext) {
  try {
    const db = await createClient();
    const tz = ctx.restaurant.timezone || DEFAULT_TIMEZONE;
    const [billing, usage, checklist] = await Promise.all([
      getBilling(db, ctx.restaurant.id),
      getUsage(db, ctx.restaurant.id, tz),
      getOnboardingChecklist(db, ctx.restaurant.id),
    ]);
    return {
      banner: billingBanner(
        billing.subscription,
        billing.settings.gracePeriodDays,
      ),
      limits: limitWarnings(billing.plan, usage),
      checklist,
    };
  } catch (err) {
    console.error("[billing] owner notices failed", err);
    return null;
  }
}
