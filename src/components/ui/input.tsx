"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { controlClasses, describedBy, Field } from "./field";

export type InputProps = ComponentProps<"input"> & {
  label?: ReactNode;
  hint?: ReactNode;
  /** Shown in red under the field; also marks the input invalid. */
  error?: ReactNode;
  /** Optional icon inside the input, on the left (e.g. a search icon). */
  leadingIcon?: ReactNode;
  wrapperClassName?: string;
};

export function Input({
  id,
  label,
  hint,
  error,
  leadingIcon,
  required,
  className,
  wrapperClassName,
  ...props
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field
      id={inputId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      <div className="relative">
        {leadingIcon ? (
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted [&_svg]:size-5">
            {leadingIcon}
          </span>
        ) : null}
        <input
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(inputId, error, hint)}
          className={cn(
            controlClasses,
            "h-touch",
            leadingIcon && "pl-11",
            className,
          )}
          {...props}
        />
      </div>
    </Field>
  );
}
