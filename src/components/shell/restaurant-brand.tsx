import type { ReactNode } from "react";
import Image from "next/image";
import { Utensils } from "lucide-react";
import { cn } from "@/lib/utils";

/** Restaurant logo (or a default icon) + name + subtitle. */
export function RestaurantBrand({
  name,
  logoUrl,
  subtitle,
  className,
}: {
  name: string;
  logoUrl?: string | null;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt=""
          width={48}
          height={48}
          className="size-12 shrink-0 rounded-card border border-line object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-card bg-brand-700 text-white"
        >
          <Utensils className="size-6" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold text-ink">{name}</p>
        {subtitle ? <div className="truncate text-sm text-muted">{subtitle}</div> : null}
      </div>
    </div>
  );
}
