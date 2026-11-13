import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { CircleAlert, Plus } from "lucide-react";
import { AdminNav } from "@/components/admin/admin-nav";
import { SimplePage } from "@/components/shell/simple-page";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";
import { getPlatformOverview } from "@/lib/admin/queries";
import { requireSuperAdmin } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Admin" };

/** Platform super admin: overview (Phase 12). */
async function Admin() {
  const user = await requireSuperAdmin();
  const o = await getPlatformOverview();
  const tiles = [
    { label: "Restaurants", value: o.restaurants.total, href: "/admin/restaurants" },
    { label: "On trial", value: o.restaurants.trial, href: "/admin/restaurants?status=trial" },
    { label: "Active (paid)", value: o.restaurants.active, href: "/admin/restaurants?status=active" },
    { label: "Payment due", value: o.restaurants.past_due, href: "/admin/restaurants?status=past_due", bad: o.restaurants.past_due > 0 },
    { label: "Suspended", value: o.restaurants.suspended, href: "/admin/restaurants?status=suspended", bad: o.restaurants.suspended > 0 },
    { label: "Over plan limits", value: o.overLimit, href: "/admin/restaurants?status=over_limit", bad: o.overLimit > 0 },
  ];
  const usage = [
    { label: "Orders today", value: o.ordersToday.toLocaleString("en-PK") },
    { label: "Orders this month", value: o.ordersMonth.toLocaleString("en-PK") },
    { label: "WhatsApp messages today", value: o.messagesToday.toLocaleString("en-PK") },
    { label: "AI cost this month", value: `$${o.aiCostMonth.toFixed(2)}`, hint: `${o.aiTurnsMonth.toLocaleString("en-PK")} AI calls` },
  ];
  const errors = o.errors.failedWebhooks + o.errors.failedSends + o.errors.aiErrors;

  return (
    <SimplePage
      title="Orderly admin"
      subtitle={user.email ?? undefined}
      actions={
        <Link href="/admin/restaurants/new" className={buttonVariants({ className: "hidden sm:inline-flex" })}>
          <Plus aria-hidden /> New restaurant
        </Link>
      }
    >
      <AdminNav />
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="admin-restaurant-tiles">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className="h-full hover:bg-subtle">
              <p className="text-sm text-muted">{t.label}</p>
              <p className={`text-2xl font-bold ${t.bad ? "text-danger" : ""}`}>{t.value}</p>
            </Card>
          </Link>
        ))}
      </section>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="admin-usage-tiles">
        {usage.map((u) => (
          <Card key={u.label}>
            <p className="text-sm text-muted">{u.label}</p>
            <p className="text-2xl font-bold">{u.value}</p>
            {u.hint ? <p className="text-xs text-muted">{u.hint}</p> : null}
          </Card>
        ))}
      </section>
      <Card padding="lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleAlert aria-hidden className="size-5" /> Errors in the last 24 hours
          </CardTitle>
          <Link href="/admin/health" className="text-sm font-semibold text-brand-700 underline">
            Health
          </Link>
        </CardHeader>
        <p className="mb-3 text-sm">
          {o.errors.failedWebhooks} failed webhooks · {o.errors.failedSends} failed WhatsApp sends · {o.errors.aiErrors} AI errors
        </p>
        {errors === 0 && o.recentErrors.length === 0 ? (
          <p className="rounded-control border-2 border-dashed border-line px-4 py-6 text-center text-muted">No errors. 👍</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {o.recentErrors.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-3 py-2">
                <span className="font-semibold">{e.kind}</span>
                <span className="text-muted">{formatDateTime(e.at)}</span>
                {e.restaurantId ? (
                  <Link href={`/admin/restaurants/${e.restaurantId}`} className="text-brand-700 underline">
                    restaurant
                  </Link>
                ) : null}
                <span className="w-full break-words text-muted">{e.text.slice(0, 200)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </SimplePage>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <Admin />
    </Suspense>
  );
}
