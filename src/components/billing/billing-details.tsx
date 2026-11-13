import Link from "next/link";
import { CreditCard, FileText, MessageCircle, Receipt } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import {
  billingBanner,
  limitText,
  limitWarnings,
  nextDueDate,
  SUBSCRIPTION_PAYMENT_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  waLink,
  type Usage,
} from "@/lib/billing/core";
import type { Billing } from "@/lib/billing/queries";
import { formatPKR } from "@/lib/money";
import { cn } from "@/lib/utils";

export function formatDay(iso: string | null, timeZone: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(iso));
}

/** Plan, status, how to pay, payment history. Used by /settings/billing and /suspended. */
export function BillingDetails({ billing, usage, timeZone, restaurantName }: { billing: Billing; usage: Usage | null; timeZone: string; restaurantName: string }) {
  const { subscription: sub, plan, payments, settings } = billing;
  const banner = billingBanner(sub, settings.gracePeriodDays);
  const due = sub ? nextDueDate(sub) : null;
  const limits = usage ? limitWarnings(plan, usage) : [];
  const contact = waLink(settings.salesWhatsapp, `Assalam o Alaikum, I want to pay for ${restaurantName} on Orderly.`);

  return (
    <div className="flex max-w-3xl flex-col gap-4" data-testid="billing">
      {banner ? (
        <div
          className={cn(
            "rounded-card border px-4 py-3",
            banner.tone === "danger" && "border-status-cancelled-border bg-status-cancelled-bg text-status-cancelled-fg",
            banner.tone === "warning" && "border-status-awaiting-border bg-status-awaiting-bg text-status-awaiting-fg",
            banner.tone === "info" && "border-status-accepted-border bg-status-accepted-bg text-status-accepted-fg",
          )}
        >
          <p className="font-bold">{banner.title}</p>
          <p className="text-sm">{banner.body}</p>
        </div>
      ) : null}

      <Card padding="lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard aria-hidden className="size-5" /> Your plan
          </CardTitle>
          {sub ? (
            <span className="rounded-full bg-subtle px-3 py-1 text-sm font-bold" data-testid="subscription-status">
              {SUBSCRIPTION_STATUS_LABELS[sub.status]}
            </span>
          ) : null}
        </CardHeader>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Item label="Plan" value={plan ? `${plan.name} · ${formatPKR(plan.monthlyPrice)} / month` : "Not chosen yet"} />
          <Item label={sub?.status === "trial" ? "Trial ends" : "Paid until"} value={formatDay(due, timeZone)} />
          {plan ? (
            <>
              <Item label="Branches" value={`${usage?.branches ?? "—"} of ${plan.maxBranches}`} />
              <Item label="Orders this month" value={`${usage?.orders ?? "—"} of ${limitText(plan.maxOrdersPerMonth)}`} />
              <Item label="Bot chats this month" value={`${usage?.botConversations ?? "—"} of ${limitText(plan.maxBotConversationsPerMonth)}`} />
            </>
          ) : null}
        </dl>
        {limits.length ? (
          <p className="mt-3 rounded-control bg-status-awaiting-bg px-3 py-2 text-sm text-status-awaiting-fg">
            Over your plan: {limits.map((l) => l.text).join(" · ")}. Orders are not stopped — please ask us about a bigger plan.
          </p>
        ) : null}
      </Card>

      <Card padding="lg">
        <CardHeader>
          <CardTitle>How to pay</CardTitle>
        </CardHeader>
        {settings.paymentInstructions ? (
          <p className="whitespace-pre-wrap rounded-control bg-subtle p-3 text-sm" data-testid="payment-instructions">
            {settings.paymentInstructions}
          </p>
        ) : (
          <p className="text-sm text-muted">Payment details will be shared with you on WhatsApp.</p>
        )}
        <p className="mt-3 text-sm text-muted">After paying, send us the receipt or transaction ID. We update your account the same day.</p>
        {contact ? (
          <a href={contact} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "secondary" }), "mt-3")}>
            <MessageCircle aria-hidden /> Send payment proof on WhatsApp
          </a>
        ) : null}
      </Card>

      <Card padding="lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt aria-hidden className="size-5" /> Payment history
          </CardTitle>
        </CardHeader>
        {payments.length === 0 ? (
          <p className="rounded-control border-2 border-dashed border-line px-4 py-6 text-center text-muted">No payments yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid="payments">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="font-bold">{formatPKR(p.amount)}</span>
                  <span className="block text-sm text-muted">
                    {formatDay(p.createdAt, timeZone)} · {SUBSCRIPTION_PAYMENT_LABELS[p.method]}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </span>
                  <span className="block text-xs text-muted">
                    Covers {formatDay(p.periodStart, timeZone)} – {formatDay(p.periodEnd, timeZone)}
                  </span>
                </span>
                <Link href={`/billing/receipt/${p.id}`} target="_blank" className={buttonVariants({ variant: "secondary" })}>
                  <FileText aria-hidden /> Receipt
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control bg-subtle p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}
