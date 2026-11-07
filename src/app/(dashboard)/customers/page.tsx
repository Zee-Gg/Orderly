import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Ban, ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { requirePermission } from "@/lib/auth/session";
import { formatPhone } from "@/lib/orders/phone";
import { listCustomers } from "@/lib/orders/queries";
import { formatPKR } from "@/lib/money";
import { DEFAULT_TIMEZONE, formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Customers" };

async function Customers({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await requirePermission("customers.view", { onDenied: "redirect" });
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 60) : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const { customers, total, pageSize } = await listCustomers(ctx, q, page);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const tz = ctx.restaurant.timezone || DEFAULT_TIMEZONE;
  const href = (p: number) => `/customers?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div className="flex flex-col gap-4">
      <form action="/customers" className="flex gap-2">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted" />
          <input
            name="q"
            type="search"
            defaultValue={q}
            aria-label="Search customers"
            placeholder="Name or phone"
            className="h-touch w-full rounded-control border border-line-strong bg-surface pr-3 pl-11 text-base focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20 focus:outline-none"
          />
        </div>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Search
        </button>
      </form>

      {customers.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={q ? "No customers match" : "No customers yet"}
          description={q ? "Try another name or number." : "Customers are saved automatically when they order."}
        />
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-line">
            {customers.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-page">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      {c.name || "No name"}
                      {c.is_blocked ? (
                        <Badge tone="cancelled" icon={<Ban />}>
                          Blocked
                        </Badge>
                      ) : null}
                      {c.tags.map((t) => (
                        <Badge key={t} tone="brand">
                          {t}
                        </Badge>
                      ))}
                    </p>
                    <p className="text-sm text-muted">{formatPhone(c.phone)}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold">
                      {c.total_orders} order{c.total_orders === 1 ? "" : "s"} · {formatPKR(Number(c.total_spent))}
                    </p>
                    <p className="text-muted">{c.last_order_at ? `Last: ${formatDateTime(c.last_order_at, tz)}` : "No completed orders"}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-line p-3 text-sm">
            <span className="text-muted">
              {total} customer{total === 1 ? "" : "s"} · page {page} of {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link href={href(page - 1)} aria-label="Previous page" className={buttonVariants({ variant: "secondary", size: "icon" })}>
                  <ChevronLeft aria-hidden />
                </Link>
              ) : null}
              {page < pages ? (
                <Link href={href(page + 1)} aria-label="Next page" className={buttonVariants({ variant: "secondary", size: "icon" })}>
                  <ChevronRight aria-hidden />
                </Link>
              ) : null}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function CustomersPage({ searchParams }: PageProps<"/customers">) {
  return (
    <>
      <PageHeader title="Customers" description="Everyone who has ordered from you." />
      <Suspense fallback={<SkeletonList />}>
        <Customers searchParams={searchParams as Promise<{ q?: string; page?: string }>} />
      </Suspense>
    </>
  );
}
