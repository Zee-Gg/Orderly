"use client";

import { Bike, Bot, Check, Clock, MapPin, PauseCircle, PhoneCall, TriangleAlert, Utensils } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OrderTypeBadge } from "@/components/ui/order-type-badge";
import { PaymentBadge } from "@/components/ui/payment-badge";
import { SourceBadge } from "@/components/ui/source-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { paymentKindOf, type OrderStatus } from "@/lib/orders/constants";
import type { BoardOrder } from "@/lib/orders/queries";
import { nextActions } from "@/lib/orders/status";
import type { Role } from "@/lib/auth/permissions";
import { formatPKR } from "@/lib/money";
import { minutesSince, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { AssignRider } from "./assign-rider";

export type CardHandlers = {
  onOpen: (order: BoardOrder) => void;
  onMove: (order: BoardOrder, path: OrderStatus[]) => void;
  onReject: (order: BoardOrder) => void;
};

/** Order card for the board and the mobile list (design 01). */
export function OrderCard({
  order,
  role,
  now,
  urgent,
  late,
  highlighted,
  busy,
  online,
  handlers,
}: {
  order: BoardOrder;
  role: Role | null;
  now: number;
  urgent: boolean;
  late: boolean;
  highlighted: boolean;
  busy: boolean;
  online: boolean;
  handlers: CardHandlers;
}) {
  const isNew = order.status === "awaiting_acceptance";
  const actions = nextActions(order, role);
  const main = actions[0];
  const ago = timeAgo(order.createdAt, now);
  const elapsed = minutesSince(order.acceptedAt ?? order.createdAt, now);

  return (
    <Card
      padding="none"
      data-order-number={order.orderNumber}
      tone={urgent ? "urgent" : isNew ? "new" : "default"}
      className={cn(
        "transition-shadow",
        late && !urgent && "border-2 border-danger",
        highlighted && "ring-4 ring-urgent/40",
      )}
    >
      <button
        type="button"
        onClick={() => handlers.onOpen(order)}
        className="block w-full rounded-card p-4 text-left focus-visible:outline-offset-[-2px]"
        aria-label={`Order #${order.orderNumber}, ${order.customerName ?? "customer"}, open details`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-xl font-bold">#{order.orderNumber}</span>
          {isNew ? (
            <span className={cn("flex items-center gap-1 text-sm", urgent ? "font-bold text-brand-700" : "text-muted")}>
              <Clock aria-hidden className="size-4" />
              {ago}
            </span>
          ) : order.status === "accepted" || order.status === "preparing" ? (
            <StatusBadge status={order.status} />
          ) : (
            <span className="text-sm text-muted">
              {order.status === "ready" ? `ready ${minutesSince(order.readyAt ?? order.createdAt, now)} min` : null}
              {order.status === "out_for_delivery" ? `left ${minutesSince(order.dispatchedAt ?? order.createdAt, now)} min` : null}
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="truncate text-base font-semibold">{order.customerName || "Walk-in customer"}</span>
          {order.status === "accepted" || order.status === "preparing" ? (
            <span className="shrink-0 text-sm text-muted">{elapsed} min</span>
          ) : (
            <OrderTypeBadge type={order.orderType} size="md" />
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5 empty:hidden">
          {order.riskCount > 0 ? (
            <Badge tone="danger-outline" shape="square" icon={<TriangleAlert />}>
              Fake order risk · {order.riskCount} refused before
            </Badge>
          ) : null}
          {order.riskFlag ? (
            <Badge tone="danger-outline" shape="square" icon={<PhoneCall />}>
              {order.riskFlag}
            </Badge>
          ) : null}
          {order.isOnHold ? (
            <Badge tone="awaiting" shape="square" icon={<PauseCircle />}>
              On hold{order.holdReason ? ` · ${order.holdReason}` : ""}
            </Badge>
          ) : null}
          {late ? (
            <Badge tone="cancelled" shape="square" icon={<Clock />}>
              Late
            </Badge>
          ) : null}
        </div>

        <p className="mt-2 line-clamp-3 text-sm">
          <span className="font-bold">
            {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
          </span>
          <span className="text-muted"> · {order.itemSummary}</span>
        </p>

        {order.orderType === "delivery" && order.area ? (
          <p className="mt-1.5 flex items-center gap-1 text-sm text-muted">
            <MapPin aria-hidden className="size-4 shrink-0" /> {order.area}
          </p>
        ) : null}
        {order.orderType === "delivery" && order.riderName && (order.status === "ready" || order.status === "out_for_delivery") ? (
          <p className="mt-1.5 flex items-center gap-1 text-sm font-semibold text-status-delivery-fg" data-testid="card-rider">
            <Bike aria-hidden className="size-4 shrink-0" /> {order.riderName}
          </p>
        ) : null}
        {order.orderType === "dine_in" && order.tableNumber ? (
          <p className="mt-1.5 flex items-center gap-1 text-sm text-muted">
            <Utensils aria-hidden className="size-4 shrink-0" /> Table {order.tableNumber}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xl font-bold">{formatPKR(order.total)}</span>
          <PaymentBadge payment={paymentKindOf(order.paymentMethod, order.paymentStatus)} size="md" />
        </div>
        {order.source !== "walk_in" ? (
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <SourceBadge source={order.source} size="md" />
            {order.fromBot ? (
              <Badge tone="brand" shape="square" icon={<Bot />} aria-label="Taken by the AI bot">
                AI
              </Badge>
            ) : null}
          </span>
        ) : null}
      </button>

      {order.orderType === "delivery" && (order.status === "preparing" || order.status === "ready") ? (
        <div className="px-4 pb-3">
          <AssignRider order={order} compact />
        </div>
      ) : null}
      {isNew ? (
        <div className="grid grid-cols-[2fr_3fr] gap-2 px-4 pb-4">
          <Button
            variant="danger-outline"
            size="lg"
            className="min-w-0 px-3"
            disabled={busy || !online}
            onClick={() => handlers.onReject(order)}
          >
            Reject
          </Button>
          <Button
            size="lg"
            className="min-w-0 px-3"
            icon={<Check />}
            loading={busy}
            disabled={!online || !main}
            onClick={() => main && handlers.onMove(order, main.path)}
          >
            Accept
          </Button>
        </div>
      ) : main ? (
        <div className="px-4 pb-4">
          <Button
            variant="secondary"
            fullWidth
            size="lg"
            icon={<Check />}
            loading={busy}
            disabled={!online}
            onClick={() => handlers.onMove(order, main.path)}
          >
            {main.label}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
