"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TabItem<T extends string = string> = {
  value: T;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
};

export type TabsProps<T extends string = string> = {
  items: TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /**
   * underline — page-level filter ("All · 12", "New · 3")
   * pill      — scrollable chips, good on mobile ("New 3", "Ready 2")
   * segmented — grouped toggle ("All | Delivery | Pickup", "Board | List")
   */
  variant?: "underline" | "pill" | "segmented";
  "aria-label": string;
  className?: string;
};

/**
 * A row of tabs that selects one value. Pair with your own content below,
 * keyed on `value`. Arrow keys move between tabs.
 */
export function Tabs<T extends string>({
  items,
  value,
  onValueChange,
  variant = "underline",
  "aria-label": ariaLabel,
  className,
}: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % items.length;
    else if (e.key === "ArrowLeft")
      next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onValueChange(items[next].value);
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex",
        variant === "underline" && "gap-1 border-b border-line",
        variant === "pill" &&
          "-mx-4 gap-2 overflow-x-auto px-4 [scrollbar-width:none]",
        variant === "segmented" && "inline-flex gap-1 rounded-control bg-subtle p-1",
        className,
      )}
    >
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex shrink-0 items-center justify-center gap-1.5 text-sm font-semibold whitespace-nowrap transition-colors [&_svg]:size-4",
              variant === "underline" &&
                cn(
                  "-mb-px min-h-touch border-b-2 px-3",
                  selected
                    ? "border-brand-700 text-brand-700"
                    : "border-transparent text-muted hover:text-ink",
                ),
              variant === "pill" &&
                cn(
                  "min-h-touch rounded-full border px-4",
                  selected
                    ? "border-ink bg-ink text-white"
                    : "border-line-strong bg-surface text-ink hover:bg-subtle",
                ),
              variant === "segmented" &&
                cn(
                  "min-h-10 rounded-[8px] px-3.5",
                  selected
                    ? "bg-surface text-ink shadow-card"
                    : "text-muted hover:text-ink",
                ),
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined ? (
              <span className={cn(variant === "underline" ? "" : "opacity-80")}>
                {variant === "underline" ? `· ${item.count}` : item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
