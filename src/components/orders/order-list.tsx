"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PaymentBadge } from "@/components/ui/payment-badge";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceBadge } from "@/components/ui/source-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { listOrdersAction } from "@/lib/orders/actions";
import {
  ORDER_SOURCES,
  ORDER_TYPE_LABELS,
  ORDER_TYPES,
  PAYMENT_STATUSES,
  SOURCE_LABELS,
  paymentKindOf,
  type OrderSource,
  type OrderType,
  type PaymentStatus,
} from "@/lib/orders/constants";
import type { BoardOrder } from "@/lib/orders/queries";
import { STATUS_FILTERS, type StatusFilterKey } from "@/lib/orders/status";
import { formatPKR } from "@/lib/money";
import { formatDateTime, localDate } from "@/lib/time";
import { ClipboardList } from "lucide-react";

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  pending_verification: "Checking payment",
  paid: "Paid",
  refunded: "Refunded",
  partially_refunded: "Partly refunded",
};

/** List/table view with filters (default: today), search and pages. */
export function OrderList({
  timezone,
  refreshKey,
  onOpen,
}: {
  timezone: string;
  /** Changes when live data changes, so the list refreshes too. */
  refreshKey: string;
  onOpen: (id: string) => void;
}) {
  const today = localDate(new Date(), timezone);
  const [status, setStatus] = useState<StatusFilterKey>("all");
  const [orderType, setOrderType] = useState<OrderType | "">("");
  const [source, setSource] = useState<OrderSource | "">("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | "">("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ orders: BoardOrder[]; total: number; pageSize: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    startLoading(async () => {
      const r = await listOrdersAction({
        statuses: STATUS_FILTERS.find((f) => f.key === status)?.statuses as never,
        orderType,
        source,
        paymentStatus,
        from,
        to: to < from ? from : to,
        search: query,
        page,
      });
      if (r.ok) {
        setResult(r.data);
        setError(null);
      } else setError(r.message);
    });
  }, [status, orderType, source, paymentStatus, from, to, query, page, refreshKey]);

  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <Card padding="sm" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          type="search"
          aria-label="Search orders"
          placeholder="Order #, phone or name"
          leadingIcon={<Search />}
          value={search}
          onChange={(e) => reset(setSearch)(e.target.value)}
          wrapperClassName="sm:col-span-2"
        />
        <Input aria-label="From date" type="date" value={from} max={today} onChange={(e) => reset(setFrom)(e.target.value || today)} />
        <Input aria-label="To date" type="date" value={to} max={today} onChange={(e) => reset(setTo)(e.target.value || today)} />
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => reset(setStatus)(e.target.value as StatusFilterKey)}
          options={STATUS_FILTERS.map((f) => ({ value: f.key, label: `Status: ${f.label}` }))}
        />
        <Select
          aria-label="Order type"
          value={orderType}
          onChange={(e) => reset(setOrderType)(e.target.value as OrderType | "")}
          options={[{ value: "", label: "All types" }, ...ORDER_TYPES.map((t) => ({ value: t, label: ORDER_TYPE_LABELS[t] }))]}
        />
        <Select
          aria-label="Source"
          value={source}
          onChange={(e) => reset(setSource)(e.target.value as OrderSource | "")}
          options={[{ value: "", label: "All sources" }, ...ORDER_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))]}
        />
        <Select
          aria-label="Payment"
          value={paymentStatus}
          onChange={(e) => reset(setPaymentStatus)(e.target.value as PaymentStatus | "")}
          options={[{ value: "", label: "All payments" }, ...PAYMENT_STATUSES.map((p) => ({ value: p, label: PAYMENT_STATUS_LABELS[p] }))]}
        />
      </Card>

      {error ? <p className="text-danger">{error}</p> : null}

      {!result ? (
        <Skeleton className="h-64 w-full" />
      ) : result.orders.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title="No orders found" description="Try another date or clear the filters." />
      ) : (
        <Card padding="none" className={loading ? "opacity-70" : undefined}>
          {/* Desktop table */}
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="bg-subtle text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="px-4 py-2">Order</th>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Items</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Payment</th>
                <th className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.orders.map((o) => (
                <tr key={o.id} onClick={() => onOpen(o.id)} className="cursor-pointer hover:bg-page">
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => onOpen(o.id)} className="font-bold hover:underline">
                      #{o.orderNumber}
                    </button>
                    <p className="text-xs text-muted">{formatDateTime(o.createdAt, timezone)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{o.customerName || "Walk-in"}</p>
                    <SourceBadge source={o.source} className="mt-1" />
                  </td>
                  <td className="max-w-64 px-4 py-3">
                    <p className="line-clamp-2 text-muted">{o.itemSummary}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3">
                    <PaymentBadge payment={paymentKindOf(o.paymentMethod, o.paymentStatus)} />
                  </td>
                  <td className="px-4 py-3 text-right font-bold whitespace-nowrap">{formatPKR(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Mobile cards */}
          <ul className="divide-y divide-line md:hidden">
            {result.orders.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => onOpen(o.id)} className="flex w-full items-start gap-3 p-4 text-left">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">
                      #{o.orderNumber} · {o.customerName || "Walk-in"}
                    </p>
                    <p className="line-clamp-1 text-sm text-muted">{o.itemSummary}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <StatusBadge status={o.status} />
                      <PaymentBadge payment={paymentKindOf(o.paymentMethod, o.paymentStatus)} />
                    </div>
                  </div>
                  <span className="font-bold">{formatPKR(o.total)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-line p-3 text-sm">
            <span className="text-muted">
              {result.total} order{result.total === 1 ? "" : "s"} · page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft />
              </Button>
              <Button variant="secondary" size="icon" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight />
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
