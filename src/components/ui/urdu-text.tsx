import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Urdu text in Noto Nastaliq Urdu, right-to-left, with the tall line-height
 * Nastaliq needs. Use for any Urdu string so fonts and direction stay right.
 */
export function UrduText({ className, ...props }: ComponentProps<"span">) {
  return (
    <span lang="ur" dir="rtl" className={cn("font-urdu", className)} {...props} />
  );
}
