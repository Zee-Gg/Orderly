"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChipInputProps = {
  label: ReactNode;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  hint?: ReactNode;
  error?: ReactNode;
  maxItems?: number;
  maxLength?: number;
  disabled?: boolean;
  /** Render chip text right-to-left when it contains Urdu. */
  className?: string;
};

const hasUrdu = (text: string) => /[؀-ۿ]/.test(text);

/**
 * A list of short words shown as chips ("Onion", "Mayo").
 * Type and press Enter or comma, or tap Add. Duplicates are ignored.
 */
export function ChipInput({
  label,
  value,
  onChange,
  placeholder = "Type and press Enter",
  hint,
  error,
  maxItems = 30,
  maxLength = 60,
  disabled,
  className,
}: ChipInputProps) {
  const id = useId();
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const parts = raw
      .split(",")
      .map((p) => p.trim().slice(0, maxLength))
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) {
      if (next.length >= maxItems) break;
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  const full = value.length >= maxItems;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-control border bg-surface p-2",
          error ? "border-danger" : "border-line-strong",
          "focus-within:border-brand-700 focus-within:ring-2 focus-within:ring-brand-700/20",
        )}
      >
        {value.map((chip) => (
          <span
            key={chip}
            dir={hasUrdu(chip) ? "rtl" : undefined}
            lang={hasUrdu(chip) ? "ur" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center gap-1 rounded-full bg-subtle py-1 pr-1 pl-3 text-sm font-medium",
              hasUrdu(chip) && "font-urdu",
            )}
          >
            {chip}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(value.filter((v) => v !== chip))}
              aria-label={`Remove ${chip}`}
              className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-line hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          disabled={disabled || full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          placeholder={full ? `Up to ${maxItems}` : placeholder}
          enterKeyHint="done"
          maxLength={maxLength * 3}
          className="min-h-9 min-w-32 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted/70"
        />
        {draft.trim() ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => add(draft)}
            className="inline-flex min-h-9 items-center gap-1 rounded-full border border-dashed border-brand-700 px-3 text-sm font-semibold text-brand-700"
          >
            <Plus aria-hidden className="size-4" />
            Add
          </button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}
