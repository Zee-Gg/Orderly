import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type CardProps = ComponentProps<"div"> & {
  /** "new" = amber border. "urgent" = amber border + pulsing ring (waiting 5+ min). */
  tone?: "default" | "new" | "urgent";
  padding?: "none" | "sm" | "md" | "lg";
};

const paddingClasses = { none: "", sm: "p-3", md: "p-4", lg: "p-6" };

export function Card({
  tone = "default",
  padding = "md",
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-card bg-surface shadow-card",
        tone === "default" && "border border-line",
        tone === "new" && "border-2 border-status-awaiting-border",
        tone === "urgent" && "animate-urgent-ring border-2 border-urgent",
        paddingClasses[padding],
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mb-3 flex items-start justify-between gap-3", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3 className={cn("text-lg font-bold text-ink", className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted", className)} {...props} />;
}
