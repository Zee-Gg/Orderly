import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared classes for text-like controls (Input, Textarea, Select). */
export const controlClasses = cn(
  "w-full rounded-control border border-line-strong bg-surface px-3.5 text-base text-ink",
  "placeholder:text-muted/70 transition-colors",
  "focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20",
  "disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted",
  "aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/15",
);

export type FieldProps = {
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

/** Label + control + hint/error. Used by Input, Textarea and Select. */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
          {required ? (
            <span className="text-danger" aria-hidden>
              {" "}
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** aria-describedby value pointing at whichever message Field renders. */
export function describedBy(id: string, error?: ReactNode, hint?: ReactNode) {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}
