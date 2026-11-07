"use client";

import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { DialogBase } from "./dialog-base";

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Sticky action bar at the bottom of the panel. */
  footer?: ReactNode;
  size?: "md" | "lg";
  children?: ReactNode;
};

const sizeClasses = { md: "sm:max-w-md", lg: "sm:max-w-xl" };

/**
 * Side panel that slides in from the right (order details, edit forms).
 * Full screen on phones.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  footer,
  size = "md",
  children,
}: DrawerProps) {
  const titleId = useId();
  return (
    <DialogBase
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      className="fixed inset-0 h-dvh w-screen"
    >
      <div
        className={cn(
          "ml-auto flex h-full w-full animate-drawer-in flex-col bg-surface shadow-overlay",
          sizeClasses[size],
        )}
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-xl font-bold text-ink">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-sm text-muted">{description}</p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close panel"
            onClick={onClose}
            className="-mr-2"
          >
            <X aria-hidden />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="grid auto-cols-fr grid-flow-col gap-3 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        ) : null}
      </div>
    </DialogBase>
  );
}
