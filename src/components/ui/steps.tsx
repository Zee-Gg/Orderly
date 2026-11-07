import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Progress indicator for multi-step forms. `current` is 0-based. */
export function Steps({
  steps,
  current,
  className,
}: {
  steps: string[];
  current: number;
  className?: string;
}) {
  return (
    <nav aria-label="Progress" className={className}>
      <p className="mb-2 text-sm font-medium text-muted">
        Step {current + 1} of {steps.length}
      </p>
      <ol className="flex gap-2">
        {steps.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={label} className="min-w-0 flex-1" aria-current={active ? "step" : undefined}>
              <div
                className={cn(
                  "h-1.5 rounded-full",
                  done || active ? "bg-brand-700" : "bg-line",
                )}
              />
              <p
                className={cn(
                  "mt-2 flex items-center gap-1 truncate text-xs font-semibold sm:text-sm",
                  active ? "text-brand-700" : done ? "text-ink" : "text-muted",
                )}
              >
                {done ? <Check aria-hidden className="size-4 shrink-0" /> : null}
                {label}
              </p>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
