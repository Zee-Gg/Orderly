import {
  Banknote,
  Check,
  CircleAlert,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import type { PaymentKind } from "@/lib/orders";
import { Badge, type BadgeProps, type BadgeTone } from "./badge";

const PAYMENT_META: Record<
  PaymentKind,
  { label: string; tone: BadgeTone; icon: LucideIcon }
> = {
  cod: { label: "COD", tone: "outline", icon: Banknote },
  bank_transfer: { label: "Bank transfer", tone: "outline", icon: Landmark },
  paid: { label: "Paid", tone: "ready", icon: Check },
  unpaid: { label: "Unpaid", tone: "danger-outline", icon: CircleAlert },
};

export type PaymentBadgeProps = Omit<
  BadgeProps,
  "tone" | "icon" | "children"
> & {
  payment: PaymentKind;
};

/** Payment method (COD, bank transfer) or payment state (paid, unpaid). */
export function PaymentBadge({ payment, ...props }: PaymentBadgeProps) {
  const { label, tone, icon: Icon } = PAYMENT_META[payment];
  return (
    <Badge tone={tone} icon={<Icon aria-hidden />} {...props}>
      {label}
    </Badge>
  );
}
