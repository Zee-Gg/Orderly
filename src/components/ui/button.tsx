import type { ComponentProps, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "danger-outline"
  | "ghost";
export type ButtonSize = "md" | "lg" | "icon" | "icon-lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-800 shadow-card",
  secondary:
    "bg-surface text-ink border border-line-strong hover:bg-subtle active:bg-line",
  danger:
    "bg-danger text-white hover:bg-danger-hover active:bg-danger-hover shadow-card",
  "danger-outline":
    "bg-surface text-danger border border-status-cancelled-border hover:bg-status-cancelled-bg",
  ghost: "bg-transparent text-ink hover:bg-subtle active:bg-line",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "h-touch px-4 text-sm gap-2 [&_svg]:size-4",
  lg: "h-touch-lg px-6 text-base gap-2.5 [&_svg]:size-5",
  icon: "size-touch [&_svg]:size-5",
  "icon-lg": "size-touch-lg [&_svg]:size-6",
};

/**
 * Class string for button styling. Use it to style a <Link> like a button:
 *   <Link href="/orders" className={buttonVariants({ variant: "secondary" })}>
 */
export function buttonVariants({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}) {
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center rounded-control font-semibold whitespace-nowrap transition-colors [&_svg]:shrink-0",
    "disabled:pointer-events-none disabled:border-transparent disabled:bg-line disabled:text-muted disabled:shadow-none",
    variantClasses[variant],
    sizeClasses[size],
    fullWidth && "w-full",
    className,
  );
}

type BaseProps = Omit<ComponentProps<"button">, "children"> & {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  /** Icon shown before the label (replaced by the spinner while loading). */
  icon?: ReactNode;
  children: ReactNode;
};

/** Icon-only buttons (size "icon" / "icon-lg") must have an aria-label. */
export type ButtonProps =
  | (BaseProps & { size?: "md" | "lg" })
  | (BaseProps & { size: "icon" | "icon-lg"; "aria-label": string });

export function Button({
  variant = "primary",
  size = "md",
  fullWidth,
  loading = false,
  icon,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  const isIconOnly = size === "icon" || size === "icon-lg";
  const spinner = <LoaderCircle className="animate-spin" aria-hidden />;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonVariants({ variant, size, fullWidth, className })}
      {...props}
    >
      {isIconOnly ? (
        loading ? spinner : children
      ) : (
        <>
          {loading ? spinner : icon}
          {children}
        </>
      )}
    </button>
  );
}
