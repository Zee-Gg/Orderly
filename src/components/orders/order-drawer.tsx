"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  Ban,
  Banknote,
  Bike,
  Check,
  ExternalLink,
  MapPin,
  MessageCircle,
  Pencil,
  PauseCircle,
  Phone,
  PlayCircle,
  Printer,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { OrderTypeBadge } from "@/components/ui/order-type-badge";
import { PaymentBadge } from "@/components/ui/payment-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceBadge } from "@/components/ui/source-badge";
import { ORDER_STATUS_META, StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { can, type Role } from "@/lib/auth/permissions";
import { getOrderDetailAction, holdOrderAction, transitionOrderAction } from "@/lib/orders/actions";
import { PAYMENT_METHOD_LABELS, SOURCE_LABELS, paymentKindOf, type OrderStatus } from "@/lib/orders/constants";
import { formatPhone } from "@/lib/orders/phone";
import type { OrderDetail } from "@/lib/orders/queries";
import { canEdit, canTransition, nextActions, reasonLabel } from "@/lib/orders/status";
import { formatPKR } from "@/lib/money";
import { formatClock, formatDateTime } from "@/lib/time";
import { BlockCustomerDialog, CancelDialog, HoldDialog, PaymentDialog } from "./order-dialogs";

type EventRow = OrderDetail["events"][number];

function eventText(e: EventRow): string {
  const to = e.to_status ? ORDER_STATUS_META[e.to_status as OrderStatus]?.label : "";
  const data = (e.data ?? {}) as Record<string, unknown>;
  switch (e.event_type) {
    case "created":
      return `Order placed${data.source ? ` · ${SOURCE_LABELS[data.source as keyof typeof SOURCE_LABELS] ?? String(data.source)}` : ""}`;
    case "status_changed":
      return e.to_status === "failed" ? `Delivery failed · ${reasonLabel(String(data.reason ?? ""))}` : `Marked ${to.toLowerCase()}`;
    case "cancelled":
      return `Cancelled · ${reasonLabel(String(data.reason ?? ""))}${data.note ? ` — ${String(data.note)}` : ""}`;
    case "edited": {
      const before = (data.before as { total?: number } | undefined)?.total;
      const after = (data.after as { total?: number } | undefined)?.total;
      return `Order edited${before !== undefined && after !== undefined && before !== after ? ` · ${formatPKR(before)} → ${formatPKR(after)}` : ""}${data.kitchen_alert ? " · kitchen alerted" : ""}`;
    }
    case "held":
      return `Put on hold · ${String(data.reason ?? "")}`;
    case "unheld":
      return "Released from hold";
    case "payment_updated":
      return `Marked paid · ${PAYMENT_METHOD_LABELS[data.method as keyof typeof PAYMENT_METHOD_LABELS] ?? ""}${data.reference ? ` (${String(data.reference)})` : ""}`;
    default:
      return e.event_type.replace("_", " ");
  }
}

type Dialog = "cancel" | "fail" | "hold" | "pay" | "block" | null;

export function OrderDrawer({
  orderId,
  boardVersion,
  role,
  online,
  onClose,
  onChanged,
}: {
  orderId: string | null;
  /** Version of this order on the live board — refetch when it changes. */
  boardVersion: number | undefined;
  role: Role | null;
  online: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async (id: string) => {
    const result = await getOrderDetailAction(id);
    if (!result.ok) setLoadError(result.message);
    else if (!result.data) setLoadError("This order wasn't found.");
    else {
      setLoadError(null);
      setOrder(result.data);
    }
  }, []);

  useEffect(() => {
    if (!orderId) return;
    let stale = false;
    getOrderDetailAction(orderId).then((result) => {
      if (stale) return;
      if (!result.ok) setLoadError(result.message);
      else if (!result.data) setLoadError("This order wasn't found.");
      else {
        setLoadError(null);
        setOrder(result.data);
      }
    });
    return () => {
      stale = true;
    };
  }, [orderId, boardVersion]);

  const shown = order && order.id === orderId ? order : null;
  const changed = () => {
    onChanged();
    if (orderId) void load(orderId);
  };

  function move(path: OrderStatus[]) {
    if (!shown) return;
    startTransition(async () => {
      const result = await transitionOrderAction({ orderId: shown.id, expectedVersion: shown.version, path });
      if (!result.ok) toast({ title: result.message, tone: "error" });
      else toast({ title: `Order #${shown.order_number} · ${ORDER_STATUS_META[result.data.status].label}` });
      changed();
    });
  }

  function unhold() {
    if (!shown) return;
    startTransition(async () => {
      const result = await holdOrderAction({ orderId: shown.id, expectedVersion: shown.version, hold: false });
      if (!result.ok) toast({ title: result.message, tone: "error" });
      changed();
    });
  }

  const ref = shown
    ? { id: shown.id, orderNumber: shown.order_number, version: shown.version, customerName: shown.customer_name, total: shown.total }
    : null;
  const finished = shown ? ["delivered", "completed", "cancelled", "failed"].includes(shown.status) : true;
  const actions = shown ? nextActions({ status: shown.status, orderType: shown.order_type, isOnHold: shown.is_on_hold }, role) : [];
  const canCancel =
    shown && canTransition({ from: shown.status, to: "cancelled", orderType: shown.order_type, role, isOnHold: shown.is_on_hold }).ok;
  const canFail = shown && canTransition({ from: shown.status, to: "failed", orderType: shown.order_type, role }).ok;
  const editCheck = shown ? canEdit(shown.status, role) : { ok: false as const, message: "" };
  const customer = shown?.customer ?? null;
  const tz = shown?.timezone;
  const offline = !online;

  return (
    <Drawer
      open={orderId !== null}
      onClose={onClose}
      size="lg"
      title={shown ? `#${shown.order_number}` : "Order"}
      description={shown ? `${shown.branch?.name ?? ""} · ${formatDateTime(shown.created_at, tz)}` : undefined}
      footer={
        shown && !finished ? (
          <div className="flex flex-col gap-2">
            {offline ? <p className="text-sm text-danger">You’re offline. Actions are paused until you reconnect.</p> : null}
            <div className="grid auto-cols-fr grid-flow-col gap-2">
              {actions.map((a) => (
                <Button
                  key={a.key}
                  variant={a.variant}
                  size="lg"
                  icon={a.key.startsWith("accept") ? <Check /> : a.key === "dispatch" ? <Bike /> : <PlayCircle />}
                  loading={pending}
                  disabled={offline}
                  onClick={() => move(a.path)}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          </div>
        ) : undefined
      }
    >
      {!shown ? (
        loadError ? (
          <Alert>{loadError}</Alert>
        ) : (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={shown.status} size="md" />
            <OrderTypeBadge type={shown.order_type} size="md" />
            <SourceBadge source={shown.source} size="md" />
            <PaymentBadge payment={paymentKindOf(shown.payment_method, shown.payment_status)} size="md" />
          </div>

          {shown.is_on_hold ? (
            <Alert tone="info" title="On hold">
              {shown.hold_reason}
            </Alert>
          ) : null}
          {shown.status === "cancelled" || shown.status === "failed" ? (
            <Alert title={shown.status === "failed" ? "Delivery failed" : "Cancelled"}>
              {reasonLabel(shown.cancel_reason)}
              {shown.cancel_note ? ` — ${shown.cancel_note}` : ""}
            </Alert>
          ) : null}

          {/* Customer */}
          <section className="rounded-card border border-line p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-bold">{shown.customer_name || "Walk-in customer"}</p>
                {shown.customer_phone ? <p className="text-muted">{formatPhone(shown.customer_phone)}</p> : null}
                {customer && customer.total_orders > 0 ? (
                  <p className="text-sm text-muted">{customer.total_orders} completed orders</p>
                ) : null}
              </div>
              {shown.customer_phone ? (
                <div className="flex shrink-0 gap-2">
                  <a href={`tel:${shown.customer_phone}`} className={buttonVariants({ variant: "secondary", size: "icon" })} aria-label="Call customer">
                    <Phone aria-hidden />
                  </a>
                  <a
                    href={`https://wa.me/${shown.customer_phone.replace("+", "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: "secondary", size: "icon" })}
                    aria-label="Message on WhatsApp"
                  >
                    <MessageCircle aria-hidden className="text-whatsapp" />
                  </a>
                </div>
              ) : null}
            </div>
            {customer && customer.cancelled_count + customer.refused_count > 0 ? (
              <Badge tone="danger-outline" shape="square" size="md" icon={<TriangleAlert />} className="mt-2">
                {customer.refused_count} refused · {customer.cancelled_count} fake orders before
              </Badge>
            ) : null}
            {customer?.is_blocked ? (
              <Alert className="mt-2" title="Blocked customer">
                {customer.blocked_reason}
              </Alert>
            ) : null}
            {shown.order_type === "delivery" && shown.address_text ? (
              <div className="mt-3 flex gap-2 text-sm">
                <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
                <div>
                  <p>{shown.address_text}</p>
                  <p className="text-muted">
                    {[shown.area, shown.landmark && `Near ${shown.landmark}`].filter(Boolean).join(" · ")}
                  </p>
                  {shown.latitude && shown.longitude ? (
                    <a
                      href={`https://maps.google.com/?q=${shown.latitude},${shown.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex min-h-touch items-center gap-1 font-semibold text-brand-700"
                    >
                      Open in Maps <ExternalLink aria-hidden className="size-4" />
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
            {shown.order_type === "dine_in" && shown.table_number ? (
              <p className="mt-2 text-sm font-semibold">Table {shown.table_number}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {customer ? (
                <Link href={`/customers/${customer.id}`} className={buttonVariants({ variant: "ghost", className: "-ml-3" })}>
                  Customer profile
                </Link>
              ) : null}
              {customer && can(role, "customers.block") ? (
                <Button variant="ghost" icon={<Ban />} className="text-danger" onClick={() => setDialog("block")}>
                  {customer.is_blocked ? "Unblock customer" : "Block customer"}
                </Button>
              ) : null}
            </div>
          </section>

          {/* Items */}
          <section>
            <h3 className="mb-2 font-bold">Items</h3>
            <ul className="divide-y divide-line rounded-card border border-line">
              {shown.items.map((i) => (
                <li key={i.id} className="flex gap-3 p-3">
                  <span className="w-8 shrink-0 text-lg font-bold">{i.quantity}×</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {i.item_name}
                      {i.size_name ? <span className="font-normal text-muted"> · {i.size_name}</span> : null}
                    </p>
                    {i.modifiers.map((m, k) => (
                      <p key={k} className="text-sm text-muted">
                        + {m.option_name}
                        {m.price_delta ? ` (${formatPKR(m.price_delta)})` : ""}
                      </p>
                    ))}
                    {i.removals.length ? <p className="text-sm font-semibold text-danger">No {i.removals.join(", no ")}</p> : null}
                    {i.notes ? <p className="text-sm italic">“{i.notes}”</p> : null}
                  </div>
                  <span className="shrink-0 font-semibold">{formatPKR(i.line_total)}</span>
                </li>
              ))}
            </ul>
            {shown.notes ? (
              <p className="mt-2 rounded-card bg-status-awaiting-bg/60 p-3 text-sm">
                <span className="font-semibold">Note: </span>
                {shown.notes}
              </p>
            ) : null}
            <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <dt className="text-muted">Items</dt>
              <dd>{formatPKR(shown.subtotal)}</dd>
              {shown.delivery_fee ? (
                <>
                  <dt className="text-muted">Delivery</dt>
                  <dd>{formatPKR(shown.delivery_fee)}</dd>
                </>
              ) : null}
              {shown.discount ? (
                <>
                  <dt className="text-muted">Discount</dt>
                  <dd>−{formatPKR(shown.discount)}</dd>
                </>
              ) : null}
              <dt className="text-lg font-bold">Total</dt>
              <dd className="text-lg font-bold">{formatPKR(shown.total)}</dd>
            </dl>
          </section>

          {/* Payment */}
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line p-4">
            <div>
              <p className="font-bold">{PAYMENT_METHOD_LABELS[shown.payment_method]}</p>
              <p className="text-sm text-muted">
                {shown.payment_status === "paid"
                  ? `Paid${shown.payments[0]?.verifiedByName ? ` · ${shown.payments[0].verifiedByName}` : ""}${shown.payments[0]?.reference ? ` · ${shown.payments[0].reference}` : ""}`
                  : "Not paid yet"}
              </p>
            </div>
            {shown.payment_status !== "paid" && !["cancelled", "failed"].includes(shown.status) && can(role, "payments.record") ? (
              <Button variant="secondary" icon={<Banknote />} disabled={offline} onClick={() => setDialog("pay")}>
                Mark as paid
              </Button>
            ) : null}
          </section>

          {/* More actions */}
          {!finished ? (
            <section className="flex flex-wrap gap-2">
              {editCheck.ok ? (
                <Link href={`/orders/${shown.id}/edit`} className={buttonVariants({ variant: "secondary" })}>
                  <Pencil aria-hidden />
                  Edit order
                </Link>
              ) : null}
              {can(role, "orders.hold") ? (
                shown.is_on_hold ? (
                  <Button variant="secondary" icon={<PlayCircle />} loading={pending} disabled={offline} onClick={unhold}>
                    Release hold
                  </Button>
                ) : (
                  <Button variant="secondary" icon={<PauseCircle />} disabled={offline} onClick={() => setDialog("hold")}>
                    Hold
                  </Button>
                )
              ) : null}
              {canCancel ? (
                <Button variant="danger-outline" icon={<XCircle />} disabled={offline} onClick={() => setDialog("cancel")}>
                  {shown.status === "awaiting_acceptance" ? "Reject" : "Cancel order"}
                </Button>
              ) : null}
              {canFail ? (
                <Button variant="danger-outline" icon={<XCircle />} disabled={offline} onClick={() => setDialog("fail")}>
                  Delivery failed
                </Button>
              ) : null}
            </section>
          ) : null}
          <section className="flex flex-wrap gap-2">
            <Button variant="ghost" icon={<Printer />} disabled title="Coming in next update">
              Print bill
            </Button>
            <Button variant="ghost" icon={<Printer />} disabled title="Coming in next update">
              Kitchen slip
            </Button>
            {shown.order_type === "delivery" ? (
              <Button variant="ghost" icon={<Bike />} disabled title="Coming in next update">
                Assign rider
              </Button>
            ) : null}
            <p className="w-full text-xs text-muted">Printing and riders are coming in the next update.</p>
          </section>

          {/* Timeline */}
          <section>
            <h3 className="mb-2 font-bold">Timeline</h3>
            <ol className="relative flex flex-col gap-3 border-l-2 border-line pl-4">
              {shown.events.map((e) => (
                <li key={e.id} className="text-sm">
                  <span aria-hidden className="absolute -left-1.75 mt-1.5 size-3 rounded-full border-2 border-surface bg-brand-700" />
                  <p className="font-semibold">{eventText(e)}</p>
                  <p className="text-muted">
                    {formatClock(e.created_at, tz)}
                    {e.actorName ? ` · ${e.actorName}` : e.actor_type !== "staff" ? ` · ${e.actor_type}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}

      {ref && dialog === "cancel" ? (
        <CancelDialog order={ref} mode={shown?.status === "awaiting_acceptance" ? "reject" : "cancel"} onClose={() => setDialog(null)} onDone={changed} />
      ) : null}
      {ref && dialog === "fail" ? <CancelDialog order={ref} mode="fail" onClose={() => setDialog(null)} onDone={changed} /> : null}
      {ref && dialog === "hold" ? <HoldDialog order={ref} onClose={() => setDialog(null)} onDone={changed} /> : null}
      {ref && shown && dialog === "pay" ? (
        <PaymentDialog order={{ ...ref, total: shown.total }} method={shown.payment_method} onClose={() => setDialog(null)} onDone={changed} />
      ) : null}
      {customer && dialog === "block" ? (
        <BlockCustomerDialog
          customer={{ id: customer.id, name: customer.name, isBlocked: customer.is_blocked }}
          onClose={() => setDialog(null)}
          onDone={changed}
        />
      ) : null}
    </Drawer>
  );
}
