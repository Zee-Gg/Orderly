import { Bike, ShoppingBag, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { OrderType } from "@/lib/orders/constants";
import { Badge, type BadgeProps } from "./badge";

const TYPE_META: Record<OrderType, { label: string; icon: LucideIcon }> = {
  delivery: { label: "Delivery", icon: Bike },
  pickup: { label: "Pickup", icon: ShoppingBag },
  dine_in: { label: "Dine-in", icon: UtensilsCrossed },
};

export type OrderTypeBadgeProps = Omit<BadgeProps, "tone" | "icon"> & {
  type: OrderType;
};

/** Delivery / Pickup / Dine-in chip. Children append extra text, e.g. the area. */
export function OrderTypeBadge({ type, children, ...props }: OrderTypeBadgeProps) {
  const { label, icon: Icon } = TYPE_META[type];
  return (
    <Badge tone="neutral" icon={<Icon aria-hidden />} {...props}>
      {label}
      {children ? <> · {children}</> : null}
    </Badge>
  );
}
