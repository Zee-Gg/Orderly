"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { UrduText } from "@/components/ui/urdu-text";

/**
 * Restaurant open/closed toggle. UI only for now — will save to the
 * restaurant/branch record (and confirm before closing) in a later phase.
 */
export function OpenToggle({ className }: { className?: string }) {
  const [open, setOpen] = useState(true);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={open}
      aria-label={open ? "Restaurant is open. Tap to close." : "Restaurant is closed. Tap to open."}
      onClick={() => setOpen((v) => !v)}
      className={cn(
        "flex min-h-touch-lg items-center gap-3 rounded-panel border-2 px-3 py-1.5 text-left transition-colors",
        open
          ? "border-whatsapp bg-status-ready-bg/40"
          : "border-status-cancelled-border bg-status-cancelled-bg/50",
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
          <span
            className={cn(
              "text-lg font-bold tracking-wide",
              open ? "text-status-ready-fg" : "text-danger",
            )}
          >
            {open ? "OPEN" : "CLOSED"}
          </span>
          <UrduText
            className={cn(
              "text-base leading-none",
              open ? "text-status-ready-fg" : "text-danger",
            )}
          >
            {open ? "کھلا ہے" : "بند ہے"}
          </UrduText>
        </span>
        <span
          className={cn(
            "text-sm",
            open ? "text-status-ready-fg" : "text-status-cancelled-fg",
          )}
        >
          {open ? "Taking orders · tap to close" : "Not taking orders · tap to open"}
        </span>
      </span>
    </button>
  );
}
