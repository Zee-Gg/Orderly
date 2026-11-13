import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { AdminNav } from "@/components/admin/admin-nav";
import { SimplePage } from "@/components/shell/simple-page";
import { buttonVariants } from "@/components/ui/button";
import { SkeletonList } from "@/components/ui/skeleton";
import { listRestaurants } from "@/lib/admin/queries";
import { requireSuperAdmin } from "@/lib/auth/session";
import { nextDueDate, SUBSCRIPTION_STATUS_LABELS } from "@/lib/billing/core";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Restaurants" };

const FILTERS = [
  { value: "all", label: "All" },
  { value: "trial", label: "Trial" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Payment due" },
  { value: "suspended", label: "Suspended" },
  { value: "over_limit", label: "Over limits" },
];

function day(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Karachi" }).format(new Date(iso));
}

type Search = { q?: string | string[]; status?: string | string[] };

async function Restaurants({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" ? sp.status : "all";
  const rows = await listRestaurants({ q, status });

  return (
    <SimplePage
      title="Restaurants"
      subtitle={`${rows.length} shown`}
      actions={
        <Link href="/admin/restaurants/new" className={buttonVariants()}>
          <Plus aria-hidden /> New
        </Link>
      }
    >
      <AdminNav />
      <form className="flex flex-wrap items-center gap-2" role="search">
        <label className="flex min-h-touch min-w-60 flex-1 items-center gap-2 rounded-control border border-line-strong bg-surface px-3">
          <Search aria-hidden className="size-4 text-muted" />
          <input name="q" defaultValue={q} placeholder="Search name, owner, city" className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Search restaurants" />
        </label>
        <input type="hidden" name="status" value={status} />
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Search
        </button>
      </form>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={`/admin/restaurants?${new URLSearchParams({ status: f.value, ...(q ? { q } : {}) })}`}
            className={cn(
              "flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-semibold",
              status === f.value ? "border-brand-700 bg-brand-700 text-white" : "border-line-strong bg-surface",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-control border-2 border-dashed border-line px-4 py-10 text-center text-muted">No restaurants match.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto lg:mx-0" data-testid="admin-restaurants">
          <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-subtle text-xs font-bold uppercase tracking-wide text-muted">
                {["Restaurant", "Owner", "Branches", "WhatsApp", "Plan", "Status", "Trial / paid until", "Last order", "This month"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line hover:bg-subtle">
                  <td className="px-3 py-3">
                    <Link href={`/admin/restaurants/${r.id}`} className="font-bold text-brand-700 underline">
                      {r.name}
                    </Link>
                    <span className="block text-xs text-muted">
                      /{r.slug}
                      {r.city ? ` · ${r.city}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-3">{r.ownerName ?? "—"}</td>
                  <td className="px-3 py-3">{r.branches}</td>
                  <td className="px-3 py-3">{r.whatsappConnected ? "✅ Yes" : "— No"}</td>
                  <td className="px-3 py-3">{r.plan?.name ?? "—"}</td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-bold",
                        r.subscription?.status === "active" && "bg-status-ready-bg text-status-ready-fg",
                        r.subscription?.status === "trial" && "bg-status-accepted-bg text-status-accepted-fg",
                        r.subscription?.status === "past_due" && "bg-status-awaiting-bg text-status-awaiting-fg",
                        (r.subscription?.status === "suspended" || r.subscription?.status === "cancelled") && "bg-status-cancelled-bg text-status-cancelled-fg",
                      )}
                    >
                      {r.subscription ? SUBSCRIPTION_STATUS_LABELS[r.subscription.status] : "—"}
                    </span>
                    {r.overLimit.length ? <span className="mt-1 block text-xs font-semibold text-danger">Over limit</span> : null}
                  </td>
                  <td className="px-3 py-3">{day(r.subscription ? nextDueDate(r.subscription) : null)}</td>
                  <td className="px-3 py-3">{day(r.lastOrderAt)}</td>
                  <td className="px-3 py-3 text-xs">
                    {r.ordersThisMonth} orders
                    <br />
                    {r.botConversationsThisMonth} bot chats
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SimplePage>
  );
}

export default function RestaurantsPage({ searchParams }: PageProps<"/admin/restaurants">) {
  return (
    <Suspense fallback={<div className="p-4"><SkeletonList /></div>}>
      <Restaurants searchParams={searchParams as Promise<Search>} />
    </Suspense>
  );
}
