"use client";

import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { DialogBase } from "./dialog-base";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Icon in a tinted circle next to the title. */
  icon?: ReactNode;
  /** "danger" tints the icon red (reject, cancel, delete). */
  tone?: "default" | "danger";
  /** Buttons row. Put the main action last. */
  footer?: ReactNode;
  dismissible?: boolean;
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
};

const sizeClasses = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-xl" };

/**
 * Centered dialog for confirmations and short forms.
 * On phones it sits at the bottom of the screen, close to the thumb.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  icon,
  tone = "default",
  footer,
  dismissible = true,
  size = "md",
  children,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  return (
    <DialogBase
      open={open}
      onClose={onClose}
      dismissible={dismissible}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className="fixed inset-0 flex h-dvh w-screen items-end justify-center p-3 sm:items-center sm:p-6"
    >
      <div
        className={cn(
          "flex max-h-[90dvh] w-full animate-toast-in flex-col overflow-hidden rounded-panel bg-surface shadow-overlay",
          sizeClasses[size],
        )}
      >
        <div className="flex items-start gap-3 p-5 pb-3">
          {icon ? (
            <span
              aria-hidden
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5",
                tone === "danger"
                  ? "bg-status-cancelled-bg text-danger"
                  : "bg-brand-50 text-brand-700",
              )}
            >
              {icon}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-bold text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-0.5 text-sm text-muted">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={onClose}
              className="-mt-2 -mr-2"
            >
              <X aria-hidden />
            </Button>
          ) : null}
        </div>
        {children ? (
          <div className="overflow-y-auto px-5 pb-3">{children}</div>
        ) : null}
        {footer ? (
          <div className="grid auto-cols-fr grid-flow-col gap-3 p-5 pt-3">
            {footer}
          </div>
        ) : null}
      </div>
    </DialogBase>
  );
}
