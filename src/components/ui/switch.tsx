"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SwitchProps = {
  /** Controlled value. Omit to let the switch manage its own state. */
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  /** Extra text after the label, e.g. "Sold out". */
  description?: ReactNode;
  disabled?: boolean;
  /** "brand" = orange (menu availability). "success" = green (restaurant open). */
  tone?: "brand" | "success";
  size?: "md" | "lg";
  id?: string;
  className?: string;
  "aria-label"?: string;
};

/** On/off switch. The whole row (switch + label) is the touch target. */
export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  label,
  description,
  disabled,
  tone = "brand",
  size = "md",
  id,
  className,
  "aria-label": ariaLabel,
}: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const [internal, setInternal] = useState(defaultChecked);
  const isOn = checked ?? internal;

  function toggle() {
    const next = !isOn;
    if (checked === undefined) setInternal(next);
    onCheckedChange?.(next);
  }

  const track = size === "lg" ? "h-8 w-14" : "h-7 w-12";
  const thumb = size === "lg" ? "size-6" : "size-5";
  const shift = size === "lg" ? "translate-x-6" : "translate-x-5";

  return (
    <div
      className={cn(
        "inline-flex min-h-touch items-center gap-3",
        disabled && "opacity-50",
        className,
      )}
    >
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={toggle}
        className={cn(
          "relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-1 transition-colors disabled:cursor-not-allowed",
          track,
          isOn
            ? tone === "success"
              ? "bg-whatsapp"
              : "bg-brand-700"
            : "bg-line-strong",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "rounded-full bg-white shadow-card transition-transform",
            thumb,
            isOn ? shift : "translate-x-0",
          )}
        />
      </button>
      {label ? (
        <label
          htmlFor={switchId}
          className="cursor-pointer text-sm font-medium text-ink select-none"
        >
          {label}
          {description ? (
            <span className="font-normal text-muted"> · {description}</span>
          ) : null}
        </label>
      ) : null}
    </div>
  );
}
