import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone =
  | "neutral"
  | "outline"
  | "brand"
  | "awaiting"
  | "accepted"
  | "preparing"
  | "ready"
  | "delivery"
  | "delivered"
  | "cancelled"
  | "whatsapp"
  | "danger-outline";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-subtle text-ink",
  outline: "bg-surface text-ink border border-line-strong",
  brand: "bg-brand-100 text-brand-800",
  awaiting: "bg-status-awaiting-bg text-status-awaiting-fg",
  accepted: "bg-status-accepted-bg text-status-accepted-fg",
  preparing: "bg-status-preparing-bg text-status-preparing-fg",
  ready: "bg-status-ready-bg text-status-ready-fg",
  delivery: "bg-status-delivery-bg text-status-delivery-fg",
  delivered: "bg-status-delivered-bg text-status-delivered-fg",
  cancelled: "bg-status-cancelled-bg text-status-cancelled-fg",
  whatsapp:
    "bg-status-ready-bg/60 text-status-ready-fg border border-status-ready-border [&_svg]:text-whatsapp",
  "danger-outline":
    "bg-status-cancelled-bg/50 text-danger border border-status-cancelled-border",
};

export type BadgeProps = ComponentProps<"span"> & {
  tone?: BadgeTone;
  icon?: ReactNode;
  /** "pill" for status/info. "square" for risk tags (which are not a status). */
  shape?: "pill" | "square";
  size?: "sm" | "md";
};

/** Small label. Always pair color with an icon and text — never color alone. */
export function Badge({
  tone = "neutral",
  icon,
  shape = "pill",
  size = "sm",
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold whitespace-nowrap [&_svg]:shrink-0",
        size === "sm"
          ? "h-6 px-2 text-xs [&_svg]:size-3.5"
          : "h-8 px-3 text-sm [&_svg]:size-4",
        shape === "pill" ? "rounded-full" : "rounded-md",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}
