import {
  Bike,
  Check,
  CircleCheck,
  CircleCheckBig,
  CircleX,
  Flame,
  Hourglass,
  Package,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { OrderStatus } from "@/lib/orders/constants";
import { Badge, type BadgeProps, type BadgeTone } from "./badge";

type StatusMeta = { label: string; tone: BadgeTone; icon: LucideIcon | null };

/** Single source of truth for order status label + color + icon. */
export const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  pending_confirmation: { label: "Waiting for customer", tone: "delivered", icon: Hourglass },
  awaiting_acceptance: { label: "New", tone: "awaiting", icon: null }, // pulsing dot instead
  accepted: { label: "Accepted", tone: "accepted", icon: Check },
  preparing: { label: "Preparing", tone: "preparing", icon: Flame },
  ready: { label: "Ready", tone: "ready", icon: Package },
  out_for_delivery: { label: "Out for delivery", tone: "delivery", icon: Bike },
  delivered: { label: "Delivered", tone: "delivered", icon: CircleCheck },
  completed: { label: "Completed", tone: "delivered", icon: CircleCheckBig },
  cancelled: { label: "Cancelled", tone: "cancelled", icon: CircleX },
  failed: { label: "Failed", tone: "cancelled", icon: TriangleAlert },
};

export type StatusBadgeProps = Omit<BadgeProps, "tone" | "icon" | "children"> & {
  status: OrderStatus;
};

/** Order status pill: color + icon + label, from ORDER_STATUS_META. */
export function StatusBadge({ status, ...props }: StatusBadgeProps) {
  const meta = ORDER_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge
      tone={meta.tone}
      icon={
        Icon ? (
          <Icon aria-hidden />
        ) : (
          <span aria-hidden className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-urgent opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-urgent" />
          </span>
        )
      }
      {...props}
    >
      {meta.label}
    </Badge>
  );
}
