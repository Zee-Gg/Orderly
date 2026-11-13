import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { AdminNav } from "@/components/admin/admin-nav";
import { SimplePage } from "@/components/shell/simple-page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";
import { getHealthData } from "@/lib/admin/queries";
import { requireSuperAdmin } from "@/lib/auth/session";
import { aiTierWarning } from "@/lib/bot/config";
import { formatDateTime, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Health" };

const JOB_LABELS: Record<string, { label: string; every: string; maxAgeMin: number }> = {
  inbox_auto_resolve: { label: "Auto-resolve quiet chats", every: "every 15 min", maxAgeMin: 45 },
  abandon_bot_sessions: { label: "Close idle bot chats", every: "every 30 min", maxAgeMin: 90 },
  subscription_sweep: { label: "Trials and payments", every: "every hour", maxAgeMin: 150 },
  cleanup_cart_drafts: { label: "Clean old menu carts", every: "every day", maxAgeMin: 60 * 26 },
  app_maintenance: { label: "Vercel cron (backup run)", every: "every day", maxAgeMin: 60 * 26 },
};

/** Super admin: is everything working? (Phase 12) */
async function Health() {
  await requireSuperAdmin();
  const h = await getHealthData();
  const warning = aiTierWarning();
  const now = h.checkedAt;

  return (
    <SimplePage title="Health" subtitle="Last 24 hours">
      <AdminNav />
      {warning ? (
        <p className="flex items-start gap-3 rounded-card border border-status-awaiting-border bg-status-awaiting-bg px-4 py-3 text-status-awaiting-fg" data-testid="ai-tier-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" /> {warning}
        </p>
      ) : null}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Last webhook received" value={h.lastWebhookAt ? timeAgo(h.lastWebhookAt) : "Never"} hint={h.lastWebhookAt ? formatDateTime(h.lastWebhookAt) : undefined} />
        <Tile label="Failed webhooks" value={String(h.failedWebhooks.length)} bad={h.failedWebhooks.length > 0} />
        <Tile label="Failed WhatsApp sends" value={String(h.failedSends.length)} bad={h.failedSends.length > 0} />
        <Tile label="AI calls" value={String(h.aiTurns)} hint={`${h.aiErrors} errors · ${h.aiRateLimits} rate limits · ${h.aiTimeouts} timeouts`} bad={h.aiErrors + h.aiRateLimits > 0} />
      </section>

      <Card padding="lg">
        <CardHeader>
          <CardTitle>Scheduled jobs</CardTitle>
        </CardHeader>
        <ul className="flex flex-col divide-y divide-line text-sm" data-testid="jobs">
          {Object.entries(JOB_LABELS).map(([key, meta]) => {
            const j = h.jobs.find((x) => x.job === key);
            const late = !j || now - Date.parse(j.lastRunAt) > meta.maxAgeMin * 60_000;
            return (
              <li key={key} className="flex flex-wrap items-center gap-3 py-2">
                <span className={cn("size-3 shrink-0 rounded-full", !j ? "bg-line-strong" : !j.ok || late ? "bg-danger" : "bg-status-ready-fg")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <strong>{meta.label}</strong> <span className="text-muted">· {meta.every}</span>
                  {j?.error ? <span className="block text-danger">{j.error}</span> : null}
                </span>
                <span className="text-muted">{j ? `${timeAgo(j.lastRunAt)} · ${j.ok ? "OK" : "FAILED"}` : "Not run yet"}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Failed webhooks</CardTitle>
          </CardHeader>
          <ErrorList rows={h.failedWebhooks.map((x) => ({ at: x.at, text: x.error }))} />
        </Card>
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Failed WhatsApp sends</CardTitle>
          </CardHeader>
          <ErrorList rows={h.failedSends.map((x) => ({ at: x.at, text: x.error, href: `/admin/restaurants/${x.restaurantId}` }))} />
        </Card>
      </div>
    </SimplePage>
  );
}

function Tile({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <Card>
      <p className="text-sm text-muted">{label}</p>
      <p className={cn("text-2xl font-bold", bad && "text-danger")}>{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}

function ErrorList({ rows }: { rows: { at: string; text: string; href?: string }[] }) {
  if (!rows.length) return <p className="rounded-control border-2 border-dashed border-line px-4 py-6 text-center text-muted">None. 👍</p>;
  return (
    <ul className="flex flex-col divide-y divide-line text-sm">
      {rows.map((r, i) => (
        <li key={i} className="py-2">
          <span className="text-muted">{formatDateTime(r.at)}</span>
          {r.href ? (
            <Link href={r.href} className="ml-2 text-brand-700 underline">
              restaurant
            </Link>
          ) : null}
          <span className="block break-words">{r.text.slice(0, 300)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function HealthPage() {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <Health />
    </Suspense>
  );
}
