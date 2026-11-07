"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LoaderCircle, MapPin } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { ALL_BRANCHES } from "@/lib/auth/cookies";
import { selectBranch } from "@/lib/auth/selection-actions";
import { cn } from "@/lib/utils";

export type BranchOption = { id: string; name: string };

export type BranchSwitcherProps = {
  branches: BranchOption[];
  /** null = "All branches" */
  currentBranchId: string | null;
  /** Restaurant-wide members can switch and pick "All branches". */
  canSwitch: boolean;
  /**
   * "field"  — bordered, full width (desktop sidebar)
   * "inline" — plain text + chevron (mobile header, under the restaurant name)
   */
  variant?: "field" | "inline";
  className?: string;
};

/**
 * Branch picker. Uses a native <select> laid over the styled box, so phones
 * show their own fast picker. The server re-checks the choice.
 */
export function BranchSwitcher({
  branches,
  currentBranchId,
  canSwitch,
  variant = "field",
  className,
}: BranchSwitcherProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const current = branches.find((b) => b.id === currentBranchId);
  const label = current?.name ?? (branches.length ? "All branches" : "No branches");
  const interactive = canSwitch && branches.length > 1;

  function onChange(value: string) {
    startTransition(async () => {
      const result = await selectBranch(value);
      if (!result.ok) toast({ title: result.error, tone: "error" });
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "relative flex items-center text-left text-ink",
        variant === "field" &&
          "h-touch w-full gap-2.5 rounded-control border border-line-strong bg-surface px-3.5 text-base font-semibold",
        variant === "inline" && "min-h-6 gap-1 text-sm font-medium text-muted",
        interactive && variant === "field" && "hover:bg-subtle",
        className,
      )}
    >
      {variant === "field" ? <MapPin aria-hidden className="size-5 shrink-0 text-muted" /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {pending ? (
        <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-muted" />
      ) : interactive ? (
        <ChevronDown aria-hidden className={cn("shrink-0 text-muted", variant === "field" ? "size-5" : "size-4")} />
      ) : null}

      {interactive ? (
        <select
          aria-label="Choose branch"
          value={currentBranchId ?? ALL_BRANCHES}
          onChange={(e) => onChange(e.target.value)}
          disabled={pending}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        >
          <option value={ALL_BRANCHES}>All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
