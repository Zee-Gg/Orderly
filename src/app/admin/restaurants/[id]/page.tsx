import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye, FileText } from "lucide-react";
import { AdminNav } from "@/components/admin/admin-nav";
import { ChecklistCard } from "@/components/onboarding/checklist-card";
import { SimplePage } from "@/components/shell/simple-page";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";
import { getRestaurantDetail } from "@/lib/admin/queries";
import { requireSuperAdmin } from "@/lib/auth/session";
import { limitText, nextDueDate, SUBSCRIPTION_PAYMENT_LABELS, SUBSCRIPTION_STATUS_LABELS, type SubscriptionPaymentMethod } from "@/lib/billing/core";
import { listPlans } from "@/lib/billing/queries";
import { formatPKR } from "@/lib/money";
import { getOnboardingChecklist } from "@/lib/onboarding/checklist";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/time";
import { RestaurantActions } from "./restaurant-actions";

export const metadata: Metadata = { title: "Restaurant" };

function day(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" }).format(new Date(iso));
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  const [detail, plans, checklist] = await Promise.all([getRestaurantDetail(id), listPlans(db, { activeOnly: false }), getOnboardingChecklist(db, id)]);
  if (!detail) notFound();
  const { row, restaurant: r } = detail;
  const sub = row.subscription;

  return (
    <SimplePage
      title={r.name}
      subtitle={`/${r.slug}${r.city ? ` · ${r.city}` : ""} · since ${day(r.createdAt)}`}
      actions={
        <Link href={`/admin/restaurants/${id}/support`} className={buttonVariants({ variant: "secondary" })}>
          <Eye aria-hidden /> Support view
        </Link>
      }
    >
      <AdminNav />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <span className="rounded-full bg-subtle px-3 py-1 text-sm font-bold">{sub ? SUBSCRIPTION_STATUS_LABELS[sub.status] : "None"}</span>
          </CardHeader>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">Plan</dt>
            <dd className="font-semibold">{row.plan ? `${row.plan.name} · ${formatPKR(row.plan.monthlyPrice)}/mo` : "—"}</dd>
            <dt className="text-muted">{sub?.status === "trial" ? "Trial ends" : "Paid until"}</dt>
            <dd className="font-semibold">{day(sub ? nextDueDate(sub) : null)}</dd>
            {sub?.pastDueSince ? (
              <>
                <dt className="text-muted">Payment due since</dt>
                <dd className="font-semibold text-danger">{day(sub.pastDueSince)}</dd>
              </>
            ) : null}
            <dt className="text-muted">This month</dt>
            <dd>
              {row.ordersThisMonth} / {limitText(row.plan?.maxOrdersPerMonth ?? null)} orders · {row.botConversationsThisMonth} /{" "}
              {limitText(row.plan?.maxBotConversationsPerMonth ?? null)} bot chats
            </dd>
            <dt className="text-muted">Branches</dt>
            <dd>
              {row.branches} / {row.plan?.maxBranches ?? "—"}
            </dd>
          </dl>
          {row.overLimit.length ? (
            <p className="mt-3 rounded-control bg-status-awaiting-bg px-3 py-2 text-sm text-status-awaiting-fg">Over limit: {row.overLimit.join(" · ")}</p>
          ) : null}
          <RestaurantActions
            restaurantId={id}
            status={sub?.status ?? null}
            planId={sub?.planId ?? null}
            plans={plans.map((p) => ({ id: p.id, name: `${p.name} (${formatPKR(p.monthlyPrice)})${p.isActive ? "" : " — hidden"}`, price: p.monthlyPrice }))}
            notes={detail.notes}
          />
        </Card>

        <ChecklistCard checklist={checklist} linkSteps={false} />

        <Card padding="lg">
          <CardHeader>
            <CardTitle>People</CardTitle>
          </CardHeader>
          <ul className="flex flex-col divide-y divide-line text-sm">
            {detail.members.map((m) => (
              <li key={m.userId} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <strong>{m.name ?? "—"}</strong> <span className="text-muted">{m.email}</span>
                </span>
                <span className="text-muted">
                  {m.role}
                  {m.branch ? ` · ${m.branch}` : ""}
                  {m.isActive ? "" : " · switched off"}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card padding="lg">
          <CardHeader>
            <CardTitle>Branches and WhatsApp</CardTitle>
          </CardHeader>
          <ul className="flex flex-col gap-1 text-sm">
            {detail.branches.map((b) => (
              <li key={b.id}>
                <strong>{b.name}</strong>
                {b.area ? ` · ${b.area}` : ""} · {b.isActive ? (b.isOpen ? "open" : "closed") : "switched off"}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            WhatsApp:{" "}
            {detail.whatsapp ? (
              <strong>
                {detail.whatsapp.displayPhone} {detail.whatsapp.isActive ? "✅ connected" : "— off"}
              </strong>
            ) : (
              <>
                not connected ·{" "}
                <Link href="/admin/whatsapp" className="text-brand-700 underline">
                  connect
                </Link>
              </>
            )}
          </p>
        </Card>

        <Card padding="lg" className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          {detail.payments.length === 0 ? (
            <p className="rounded-control border-2 border-dashed border-line px-4 py-6 text-center text-muted">No payments yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line text-sm">
              {detail.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <strong>{formatPKR(p.amount)}</strong> · {SUBSCRIPTION_PAYMENT_LABELS[p.method as SubscriptionPaymentMethod] ?? p.method}
                    {p.reference ? ` · ${p.reference}` : ""}
                    <span className="block text-muted">
                      {formatDateTime(p.createdAt)} · covers {day(p.periodStart)} – {day(p.periodEnd)}
                    </span>
                  </span>
                  <Link href={`/billing/receipt/${p.id}`} target="_blank" className={buttonVariants({ variant: "secondary" })}>
                    <FileText aria-hidden /> Receipt #{p.receiptNumber}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </SimplePage>
  );
}

export default function RestaurantDetailPage({ params }: PageProps<"/admin/restaurants/[id]">) {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <Detail params={params} />
    </Suspense>
  );
}
