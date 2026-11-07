"use client";

import { cn } from "@/lib/utils";

/**
 * Big "In stock / Out of stock" switch from the menu design.
 * `block` makes it full width (mobile cards).
 */
export function StockToggle({
  inStock,
  onChange,
  disabled,
  block = false,
  itemName,
}: {
  inStock: boolean;
  onChange: (inStock: boolean) => void;
  disabled?: boolean;
  block?: boolean;
  itemName: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={inStock}
      aria-label={`${itemName}: ${inStock ? "in stock" : "out of stock"}`}
      disabled={disabled}
      onClick={() => onChange(!inStock)}
      className={cn(
        "flex min-h-touch shrink-0 items-center gap-3 rounded-full border-2 py-1.5 pr-4 pl-1.5 text-left text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 lg:text-base",
        block ? "w-full" : "w-44",
        inStock
          ? "border-whatsapp bg-status-ready-bg/50 text-status-ready-fg"
          : "border-status-cancelled-border bg-status-cancelled-bg/50 text-danger",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors",
          inStock ? "bg-whatsapp" : "bg-line-strong",
        )}
      >
        <span
          className={cn(
            "size-6 rounded-full bg-white shadow-card transition-transform",
            inStock ? "translate-x-6" : "translate-x-0",
          )}
        />
      </span>
      {inStock ? "In stock" : block ? "Out of stock — tap when back" : "Out of stock"}
    </button>
  );
}
