"use client";

import { useTransition } from "react";
import { Bike } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { usePermission } from "@/lib/auth/permissions-context";
import type { OrderStatus } from "@/lib/orders/constants";
import { assignRiderAction } from "@/lib/riders/actions";
import { cn } from "@/lib/utils";
import { useOrdersLiveOptional } from "./live-provider";

/** Statuses where a delivery order can get / change a rider. */
export const ASSIGNABLE: readonly OrderStatus[] = ["accepted", "preparing", "ready", "out_for_delivery"];

/**
 * "Assign rider" dropdown (Phase 9): the branch's active riders, online first,
 * with their current active deliveries. Assign, reassign or unassign; every
 * change writes an order event and alerts the rider.
 */
export function AssignRider({
  order,
  compact = false,
  onDone,
}: {
  order: { id: string; branchId: string; status: OrderStatus; orderType: string; version: number; riderId: string | null };
  compact?: boolean;
  onDone?: () => void;
}) {
  const live = useOrdersLiveOptional();
  const allowed = usePermission("riders.assign");
  const { toast } = useToast();
  const [pending, start] = useTransition();
  if (!live || !allowed || order.orderType !== "delivery" || !ASSIGNABLE.includes(order.status)) return null;

  const riders = live.snapshot.riders
    .filter((r) => r.branchId === order.branchId)
    .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || a.activeCount - b.activeCount || a.name.localeCompare(b.name));
  const current = live.snapshot.riders.find((r) => r.id === order.riderId);

  return (
    <label className={cn("flex items-center gap-2", compact ? "text-sm" : "")} onClick={(e) => e.stopPropagation()}>
      <Bike aria-hidden className={cn("shrink-0 text-status-delivery-fg", compact ? "size-4" : "size-5")} />
      <span className="sr-only">Assign rider</span>
      <select
        aria-label={`Assign rider for order`}
        data-testid="assign-rider"
        value={order.riderId ?? ""}
        disabled={pending || !live.online}
        onChange={(e) => {
          const riderId = e.target.value || null;
          start(async () => {
            const r = await assignRiderAction({ orderId: order.id, riderId, expectedVersion: order.version });
            if (!r.ok) toast({ title: r.message, tone: "error" });
            else toast({ title: riderId ? `Given to ${riders.find((x) => x.id === riderId)?.name ?? "rider"}` : "Rider removed" });
            await live.refresh();
            onDone?.();
          });
        }}
        className={cn(
          "min-h-touch w-full min-w-0 rounded-control border bg-surface px-2 font-semibold",
          order.riderId ? "border-status-delivery-border text-status-delivery-fg" : "border-line-strong text-muted",
        )}
      >
        <option value="">{riders.length ? "Assign rider…" : "No riders added"}</option>
        {current && !riders.some((r) => r.id === current.id) ? <option value={current.id}>{current.name}</option> : null}
        {riders.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} · {r.isOnline ? "online" : "offline"} · {r.activeCount} active
          </option>
        ))}
      </select>
    </label>
  );
}
