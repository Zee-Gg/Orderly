import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons. Put the main action first. */
  actions?: ReactNode;
  /** Icon circle color. */
  tone?: "brand" | "delivery" | "neutral";
  className?: string;
};

const toneClasses = {
  brand: "bg-brand-50 text-brand-700",
  delivery: "bg-status-delivery-bg text-status-delivery-fg",
  neutral: "bg-subtle text-muted",
};

/** Friendly "nothing here yet" box with a next step. */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  tone = "brand",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-panel border-2 border-dashed border-line px-6 py-12 text-center",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mb-4 flex size-16 items-center justify-center rounded-full [&_svg]:size-7",
          toneClasses[tone],
        )}
      >
        {icon}
      </span>
      <h2 className="text-xl font-bold text-ink">{title}</h2>
      {description ? (
        <p className="mt-2 max-w-sm text-base text-muted">{description}</p>
      ) : null}
      {actions ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
