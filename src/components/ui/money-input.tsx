"use client";

import { Input, type InputProps } from "./input";

/**
 * Rupee amount field with an "Rs" prefix and a number keypad on phones.
 * The value is the text the person typed; convert with parseRupees().
 */
export function MoneyInput({
  prefix = "Rs",
  ...props
}: Omit<InputProps, "type" | "inputMode" | "leadingIcon"> & { prefix?: string }) {
  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      leadingIcon={<span className="text-base font-semibold text-muted">{prefix}</span>}
    />
  );
}
