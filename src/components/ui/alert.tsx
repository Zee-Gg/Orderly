import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type AlertProps = {
  tone?: "error" | "success" | "info";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
};

const toneClasses = {
  error: "border-status-cancelled-border bg-status-cancelled-bg/60 text-status-cancelled-fg",
  success: "border-status-ready-border bg-status-ready-bg/60 text-status-ready-fg",
  info: "border-status-accepted-border bg-status-accepted-bg/60 text-status-accepted-fg",
};

const toneIcon = { error: CircleAlert, success: CircleCheck, info: Info };

/** Inline message box, e.g. a form error or "check your email". */
export function Alert({ tone = "error", title, children, className }: AlertProps) {
  const Icon = toneIcon[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-card border px-4 py-3 text-sm",
        toneClasses[tone],
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5")}>{children}</div> : null}
      </div>
    </div>
  );
}
