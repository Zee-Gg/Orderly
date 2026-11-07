"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type DialogBaseProps = {
  open: boolean;
  onClose: () => void;
  /** Close when tapping the dark area outside. Default true. */
  dismissible?: boolean;
  className?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  children: ReactNode;
};

/**
 * Internal: native <dialog> opened with showModal(). Gives focus trapping,
 * Escape-to-close and a top-layer backdrop for free, without a library.
 * Used by Modal and Drawer — use those instead of this directly.
 */
export function DialogBase({
  open,
  onClose,
  dismissible = true,
  className,
  children,
  ...aria
}: DialogBaseProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      {...aria}
      onCancel={(e) => {
        // Escape key / Android back gesture.
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        // A click whose target is the <dialog> itself landed on the backdrop.
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
      className={cn(
        "m-0 max-h-none max-w-none bg-transparent p-0 text-ink",
        "backdrop:bg-ink/50 backdrop:animate-fade-in",
        className,
      )}
    >
      {open ? children : null}
    </dialog>
  );
}
