"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { controlClasses, describedBy, Field } from "./field";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = Omit<ComponentProps<"select">, "children"> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  options: SelectOption[];
  /** Adds a first, empty option, e.g. "Choose area". */
  placeholder?: string;
  wrapperClassName?: string;
};

/**
 * Native <select> — uses the phone's own picker, which is fast and familiar
 * on low-end Android devices.
 */
export function Select({
  id,
  label,
  hint,
  error,
  options,
  placeholder,
  required,
  className,
  wrapperClassName,
  ...props
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <Field
      id={selectId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      <div className="relative">
        <select
          id={selectId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(selectId, error, hint)}
          className={cn(
            controlClasses,
            "h-touch cursor-pointer appearance-none pr-10",
            className,
          )}
          {...props}
        >
          {placeholder ? (
            <option value="" disabled={required}>
              {placeholder}
            </option>
          ) : null}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3.5 size-5 -translate-y-1/2 text-muted"
        />
      </div>
    </Field>
  );
}
