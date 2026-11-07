import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Grey placeholder block shown while data loads. Size it with className. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-subtle", className)}
      {...props}
    />
  );
}

/** Loading placeholder shaped like an order card. */
export function SkeletonCard({
  withActions = true,
  className,
}: {
  withActions?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("rounded-card border border-line bg-surface p-4", className)}
    >
      <div className="flex justify-between">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="mt-3 h-4 w-40" />
      <Skeleton className="mt-3 h-3 w-full max-w-md" />
      {withActions ? (
        <div className="mt-4 grid grid-cols-[1fr_1.6fr] gap-3">
          <Skeleton className="h-touch rounded-control" />
          <Skeleton className="h-touch rounded-control bg-line" />
        </div>
      ) : null}
    </div>
  );
}

/** Stack of skeleton cards with a screen-reader message. */
export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} withActions={i === 0} />
      ))}
    </div>
  );
}
