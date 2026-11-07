import { Globe, MessageCircle, Phone, Store, type LucideIcon } from "lucide-react";
import type { OrderSource } from "@/lib/orders/constants";
import { Badge, type BadgeProps, type BadgeTone } from "./badge";

const SOURCE_META: Record<OrderSource, { label: string; tone: BadgeTone; icon: LucideIcon }> = {
  whatsapp: { label: "WhatsApp", tone: "whatsapp", icon: MessageCircle },
  phone: { label: "Phone", tone: "neutral", icon: Phone },
  walk_in: { label: "Walk-in", tone: "neutral", icon: Store },
  web: { label: "Website", tone: "neutral", icon: Globe },
};

export type SourceBadgeProps = Omit<BadgeProps, "tone" | "icon" | "children"> & {
  source: OrderSource;
};

/** Where the order came from. */
export function SourceBadge({ source, ...props }: SourceBadgeProps) {
  const { label, tone, icon: Icon } = SOURCE_META[source];
  return (
    <Badge tone={tone} icon={<Icon aria-hidden />} {...props}>
      {label}
    </Badge>
  );
}
