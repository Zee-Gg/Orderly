import { Utensils } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Restaurant logo + name. Placeholder until restaurants exist in the DB;
 * will take the restaurant's name and logo URL as props.
 */
export function RestaurantBrand({
  name = "Tandoori Junction",
  subtitle = "by Orderly",
  className,
}: {
  name?: string;
  subtitle?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <span
        aria-hidden
        className="flex size-12 shrink-0 items-center justify-center rounded-card bg-brand-700 text-white"
      >
        <Utensils className="size-6" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-base font-bold text-ink">{name}</p>
        <div className="truncate text-sm text-muted">{subtitle}</div>
      </div>
    </div>
  );
}
