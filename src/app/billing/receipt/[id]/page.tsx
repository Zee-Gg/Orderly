import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { formatDay } from "@/components/billing/billing-details";
import { PrintButton } from "@/components/billing/print-button";
import { requirePermission, requireUser } from "@/lib/auth/session";
import { SUBSCRIPTION_PAYMENT_LABELS, type SubscriptionPaymentMethod } from "@/lib/billing/core";
import { formatPKR } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/time";

export const metadata: Metadata = { title: "Receipt" };

/**
 * Printable receipt for one subscription payment (A4 / PDF via the browser).
 * Owner of that restaurant (RLS) or the super admin.
 */
async function ReceiptContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requireUser();
  // Super admin reads any receipt; owners only their own (user client + RLS).
  const db = user.profile.is_super_admin ? createAdminClient() : await createClient();
  if (!user.profile.is_super_admin) await requirePermission("billing.view", { onDenied: "redirect" });

  const { data: p } = await db
    .from("subscription_payments")
    .select("id, restaurant_id, receipt_number, amount, method, reference, period_start, period_end, created_at, plan_id")
    .eq("id", id)
    .maybeSingle();
  if (!p) notFound();
  const [restaurant, plan] = await Promise.all([
    db.from("restaurants").select("name, city, phone, timezone").eq("id", p.restaurant_id).maybeSingle(),
    p.plan_id ? db.from("plans").select("name").eq("id", p.plan_id).maybeSingle() : null,
  ]);
  const tz = restaurant.data?.timezone || DEFAULT_TIMEZONE;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 bg-white p-6 text-black print:p-0">
      <title>{`Receipt #${p.receipt_number}`}</title>
      <div className="flex justify-end print:hidden">
        <PrintButton />
      </div>
      <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-4">
        <div>
          <p className="text-2xl font-bold">Orderly</p>
          <p className="text-sm">WhatsApp ordering for restaurants</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold">PAYMENT RECEIPT</p>
          <p className="text-sm">No. {String(p.receipt_number).padStart(5, "0")}</p>
          <p className="text-sm">{formatDay(p.created_at, tz)}</p>
        </div>
      </header>
      <section>
        <p className="text-sm uppercase tracking-wide">Received from</p>
        <p className="text-lg font-bold">{restaurant.data?.name ?? "Restaurant"}</p>
        <p className="text-sm">{[restaurant.data?.city, restaurant.data?.phone].filter(Boolean).join(" · ")}</p>
      </section>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-black">
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-black/30">
            <td className="py-3">
              Subscription{plan?.data?.name ? ` — ${plan.data.name} plan` : ""}
              <br />
              <span className="text-sm">
                {formatDay(p.period_start, tz)} to {formatDay(p.period_end, tz)}
              </span>
            </td>
            <td className="py-3 text-right font-bold">{formatPKR(p.amount)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td className="py-3 text-right font-bold">Total paid</td>
            <td className="py-3 text-right text-xl font-bold">{formatPKR(p.amount)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="text-sm">
        Paid by {SUBSCRIPTION_PAYMENT_LABELS[p.method as SubscriptionPaymentMethod] ?? p.method}
        {p.reference ? ` · Reference: ${p.reference}` : ""}
      </p>
      <p className="border-t border-black/30 pt-4 text-center text-sm">Thank you for using Orderly.</p>
    </main>
  );
}

export default function ReceiptPage({ params }: PageProps<"/billing/receipt/[id]">) {
  return (
    <Suspense fallback={null}>
      <ReceiptContent params={params} />
    </Suspense>
  );
}
