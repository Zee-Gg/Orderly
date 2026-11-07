"use client";

import { useOptimistic, useTransition } from "react";
import { Store } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { UrduText } from "@/components/ui/urdu-text";
import { setBranchOpen } from "@/lib/branches/actions";
import { cn } from "@/lib/utils";

export type OpenToggleProps = {
  /** null when "All branches" is selected. */
  branch: { id: string; name: string; isOpen: boolean } | null;
  canToggle: boolean;
  className?: string;
};

/** Big open/closed switch for the current branch (branches.is_open). */
export function OpenToggle({ branch, canToggle, className }: OpenToggleProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOptimisticOpen] = useOptimistic(branch?.isOpen ?? false);

  if (!branch) {
    return (
      <div
        className={cn(
          "flex min-h-touch-lg items-center gap-3 rounded-panel border-2 border-dashed border-line-strong px-4 py-2 text-sm text-muted",
          className,
        )}
      >
        <Store aria-hidden className="size-5 shrink-0" />
        <span>
          <span className="font-semibold text-ink">All branches.</span> Choose one branch to open or
          close it.
        </span>
      </div>
    );
  }

  function toggle() {
    if (!branch) return;
    const next = !open;
    startTransition(async () => {
      setOptimisticOpen(next);
      const result = await setBranchOpen(branch.id, next);
      if (!result.ok) {
        toast({ title: result.error, tone: "error" });
      } else {
        toast({
          title: next ? `${branch.name} is open` : `${branch.name} is closed`,
          description: next ? "You're taking orders now." : "New orders are paused.",
          tone: next ? "success" : "info",
        });
      }
    });
  }

  const hint = !canToggle
    ? "Only owners and managers can change this"
    : open
      ? "Taking orders · tap to close"
      : "Not taking orders · tap to open";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={open}
      aria-label={`${branch.name} is ${open ? "open" : "closed"}. ${hint}.`}
      onClick={toggle}
      disabled={!canToggle || pending}
      className={cn(
        "flex min-h-touch-lg items-center gap-3 rounded-panel border-2 px-3 py-1.5 text-left transition-colors disabled:cursor-not-allowed",
        open
          ? "border-whatsapp bg-status-ready-bg/40"
          : "border-status-cancelled-border bg-status-cancelled-bg/50",
        pending && "opacity-80",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors",
          open ? "bg-whatsapp" : "bg-line-strong",
        )}
      >
        <span
          className={cn(
            "size-6 rounded-full bg-white shadow-card transition-transform",
            open ? "translate-x-6" : "translate-x-0",
          )}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3">
        <span className="flex items-baseline gap-2">
          <span className={cn("text-lg font-bold tracking-wide", open ? "text-status-ready-fg" : "text-danger")}>
            {open ? "OPEN" : "CLOSED"}
          </span>
          <UrduText className={cn("text-base leading-none", open ? "text-status-ready-fg" : "text-danger")}>
            {open ? "کھلا ہے" : "بند ہے"}
          </UrduText>
        </span>
        <span className={cn("text-sm", open ? "text-status-ready-fg" : "text-status-cancelled-fg")}>
          {hint}
        </span>
      </span>
    </button>
  );
}
