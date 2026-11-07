import { Bike, ShoppingBag, type LucideIcon } from "lucide-react";
import type { OrderType } from "@/lib/orders";
import { Badge, type BadgeProps } from "./badge";

const TYPE_META: Record<OrderType, { label: string; icon: LucideIcon }> = {
  delivery: { label: "Delivery", icon: Bike },
  pickup: { label: "Pickup", icon: ShoppingBag },
};

export type OrderTypeBadgeProps = Omit<BadgeProps, "tone" | "icon"> & {
  type: OrderType;
};

/** Delivery / Pickup chip. Children append extra text, e.g. the area. */
export function OrderTypeBadge({
  type,
  children,
  ...props
}: OrderTypeBadgeProps) {
  const { label, icon: Icon } = TYPE_META[type];
  return (
    <Badge tone="neutral" icon={<Icon aria-hidden />} {...props}>
      {label}
      {children ? <> · {children}</> : null}
    </Badge>
  );
}
