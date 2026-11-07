import { ChevronDown, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Placeholder. Will list the branches from the user's memberships and switch
 * the active branch. Disabled until branches exist.
 *
 * "field"  — bordered, full width (desktop sidebar)
 * "inline" — plain text + chevron (mobile header, under the restaurant name)
 */
export function BranchSwitcher({
  variant = "field",
  className,
}: {
  variant?: "field" | "inline";
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled
      title="Branch switching will be available once branches are set up"
      className={cn(
        "flex items-center text-left text-ink disabled:cursor-not-allowed",
        variant === "field" &&
          "h-touch w-full gap-2.5 rounded-control border border-line-strong bg-surface px-3.5 text-base font-semibold",
        variant === "inline" && "gap-1 text-sm font-medium text-muted",
        className,
      )}
    >
      {variant === "field" ? (
        <MapPin aria-hidden className="size-5 shrink-0 text-muted" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">DHA Branch</span>
      <ChevronDown
        aria-hidden
        className={cn("shrink-0 text-muted", variant === "field" ? "size-5" : "size-4")}
      />
    </button>
  );
}
