import {
  Banknote,
  Check,
  CircleAlert,
  CreditCard,
  Hourglass,
  Landmark,
  Link2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { PaymentKind } from "@/lib/orders/constants";
import { Badge, type BadgeProps, type BadgeTone } from "./badge";

const PAYMENT_META: Record<PaymentKind, { label: string; tone: BadgeTone; icon: LucideIcon }> = {
  cod: { label: "COD", tone: "outline", icon: Banknote },
  card_on_delivery: { label: "Card", tone: "outline", icon: CreditCard },
  bank_transfer: { label: "Bank transfer", tone: "outline", icon: Landmark },
  online_link: { label: "Online", tone: "outline", icon: Link2 },
  paid: { label: "Paid", tone: "ready", icon: Check },
  unpaid: { label: "Unpaid", tone: "danger-outline", icon: CircleAlert },
  pending_verification: { label: "Checking payment", tone: "awaiting", icon: Hourglass },
  refunded: { label: "Refunded", tone: "delivered", icon: Undo2 },
};

export type PaymentBadgeProps = Omit<BadgeProps, "tone" | "icon" | "children"> & {
  payment: PaymentKind;
};

/** Payment method (COD, card, transfer) or payment state (paid, unpaid). */
export function PaymentBadge({ payment, ...props }: PaymentBadgeProps) {
  const { label, tone, icon: Icon } = PAYMENT_META[payment];
  return (
    <Badge tone={tone} icon={<Icon aria-hidden />} {...props}>
      {label}
    </Badge>
  );
}
