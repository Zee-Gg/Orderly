"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, Bike, ClipboardList, Columns3, Flame, List, Package, Plus } from "lucide-react";
import { useOrdersLive } from "@/components/orders/live-provider";
import { SoundToggle } from "@/components/orders/live-alerts";
import { OrderCard, type CardHandlers } from "@/components/orders/order-card";
import { CancelDialog } from "@/components/orders/order-dialogs";
import { OrderDrawer } from "@/components/orders/order-drawer";
import { OrderList } from "@/components/orders/order-list";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { usePermission, useRole } from "@/lib/auth/permissions-context";
import { transitionOrderAction } from "@/lib/orders/actions";
import type { OrderStatus, OrderType } from "@/lib/orders/constants";
import type { BoardOrder } from "@/lib/orders/queries";
import { BOARD_COLUMNS } from "@/lib/orders/status";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ORDER_STATUS_META } from "@/components/ui/status-badge";

const COLUMN_STYLE: Record<string, { icon: typeof Bell; className: string; heading: string; count: string }> = {
  new: { icon: Bell, className: "bg-status-awaiting-bg/50 border-status-awaiting-border", heading: "text-status-awaiting-fg", count: "bg-urgent text-white" },
  preparing: { icon: Flame, className: "bg-subtle border-line", heading: "text-status-preparing-fg", count: "bg-status-preparing-bg text-status-preparing-fg" },
  ready: { icon: Package, className: "bg-subtle border-line", heading: "text-status-ready-fg", count: "bg-status-ready-bg text-status-ready-fg" },
  out: { icon: Bike, className: "bg-subtle border-line", heading: "text-status-delivery-fg", count: "bg-status-delivery-bg text-status-delivery-fg" },
};

export function OrdersScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { toast } = useToast();
  const role = useRole();
  const canCreate = usePermission("orders.create");
  const live = useOrdersLive();
  const { snapshot, now, urgent, isLate, highlighted, online, refresh, timezone } = live;

  const [view, setView] = useState<"board" | "list">("board");
  const [typeFilter, setTypeFilter] = useState<"all" | OrderType>("all");
  const [mobileColumn, setMobileColumn] = useState<string>("new");
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<BoardOrder | null>(null);

  const openId = params.get("order");
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("order", id);
    else next.delete("order");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const orders = snapshot.orders.filter((o) => typeFilter === "all" || o.orderType === typeFilter);
  const urgentIds = new Set(urgent.map((o) => o.id));

  async function move(order: BoardOrder, path: OrderStatus[]) {
    setBusy(order.id);
    const result = await transitionOrderAction({ orderId: order.id, expectedVersion: order.version, path });
    setBusy(null);
    if (!result.ok) toast({ title: result.message, tone: "error" });
    else toast({ title: `Order #${order.orderNumber} · ${ORDER_STATUS_META[result.data.status].label}` });
    await refresh();
  }

  const handlers: CardHandlers = {
    onOpen: (o) => setOpen(o.id),
    onMove: (o, path) => void move(o, path),
    onReject: (o) => setRejecting(o),
  };

  const card = (o: BoardOrder) => (
    <OrderCard
      key={o.id}
      order={o}
      role={role}
      now={now}
      urgent={urgentIds.has(o.id)}
      late={isLate(o)}
      highlighted={highlighted.has(o.id)}
      busy={busy === o.id}
      online={online}
      handlers={handlers}
    />
  );

  const columns = BOARD_COLUMNS.map((c) => ({
    ...c,
    orders: orders.filter((o) => (c.statuses as OrderStatus[]).includes(o.status)),
  }));
  const boardOrder = snapshot.orders.find((o) => o.id === openId);

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">Orders</h1>
          <p className="text-muted">{formatDateTime(new Date(now).toISOString(), timezone)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === "board" ? (
            <Tabs
              variant="segmented"
              aria-label="Order type"
              value={typeFilter}
              onValueChange={setTypeFilter}
              items={[
                { value: "all", label: "All" },
                { value: "delivery", label: "Delivery" },
                { value: "pickup", label: "Pickup" },
                { value: "dine_in", label: "Dine-in" },
              ]}
            />
          ) : null}
          <Tabs
            variant="segmented"
            aria-label="View"
            value={view}
            onValueChange={setView}
            items={[
              { value: "board", label: "Board", icon: <Columns3 aria-hidden /> },
              { value: "list", label: "List", icon: <List aria-hidden /> },
            ]}
          />
          <SoundToggle />
          {canCreate ? (
            <Link href="/orders/new" className={buttonVariants()}>
              <Plus aria-hidden />
              New order
            </Link>
          ) : null}
        </div>
      </div>

      {view === "list" ? (
        <OrderList timezone={timezone} refreshKey={snapshot.fetchedAt} onOpen={(id) => setOpen(id)} />
      ) : snapshot.orders.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title="No orders right now"
          description="When customers order on WhatsApp, their orders will show here — with a sound."
          actions={
            canCreate ? (
              <Link href="/orders/new" className={buttonVariants({ size: "lg" })}>
                <Plus aria-hidden />
                Add phone order
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          {/* Mobile: one column at a time */}
          <div className="lg:hidden">
            <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {columns.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={mobileColumn === c.key}
                  onClick={() => setMobileColumn(c.key)}
                  className={cn(
                    "flex min-h-touch shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold",
                    mobileColumn === c.key ? "border-ink bg-ink text-white" : "border-line-strong bg-surface",
                  )}
                >
                  {c.key === "new" && c.orders.length ? <span aria-hidden className="size-2 rounded-full bg-urgent" /> : null}
                  {c.key === "out" ? "Out" : c.label} {c.orders.length}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              {columns.find((c) => c.key === mobileColumn)!.orders.map(card)}
              {columns.find((c) => c.key === mobileColumn)!.orders.length === 0 ? (
                <p className="py-10 text-center text-muted">Nothing here right now.</p>
              ) : null}
            </div>
          </div>

          {/* Desktop: kanban */}
          <div className="hidden gap-4 overflow-x-auto pb-2 lg:grid lg:grid-cols-[repeat(4,minmax(260px,1fr))]">
            {columns.map((c) => {
              const style = COLUMN_STYLE[c.key];
              const Icon = style.icon;
              return (
                <section key={c.key} aria-label={c.label} className={cn("flex flex-col gap-3 self-start rounded-panel border p-3", style.className)}>
                  <h2 className={cn("flex items-center gap-2 px-1 text-lg font-bold", style.heading)}>
                    {c.key === "new" && c.orders.length ? <span aria-hidden className="size-2.5 rounded-full bg-urgent" /> : null}
                    <Icon aria-hidden className="size-5" />
                    <span className="flex-1">{c.label}</span>
                    <span className={cn("flex size-8 items-center justify-center rounded-full text-sm font-bold", style.count)}>
                      {c.orders.length}
                    </span>
                  </h2>
                  {c.orders.map(card)}
                  {c.orders.length === 0 ? <p className="px-1 py-6 text-center text-sm text-muted">Nothing here</p> : null}
                </section>
              );
            })}
          </div>
        </>
      )}

      <OrderDrawer
        orderId={openId}
        boardVersion={boardOrder?.version}
        role={role}
        online={online}
        onClose={() => setOpen(null)}
        onChanged={() => void refresh()}
      />

      {rejecting ? (
        <CancelDialog
          order={{ id: rejecting.id, orderNumber: rejecting.orderNumber, version: rejecting.version, customerName: rejecting.customerName }}
          mode="reject"
          onClose={() => setRejecting(null)}
          onDone={() => void refresh()}
        />
      ) : null}
    </>
  );
}
