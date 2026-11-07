"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input, type InputProps } from "./input";

/** Password field with a show/hide button (easier typing on phones). */
export function PasswordInput(props: Omit<InputProps, "type" | "trailing">) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="flex size-touch items-center justify-center rounded-control text-muted hover:text-ink"
        >
          {visible ? (
            <EyeOff aria-hidden className="size-5" />
          ) : (
            <Eye aria-hidden className="size-5" />
          )}
        </button>
      }
    />
  );
}
