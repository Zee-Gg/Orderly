"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Check, CircleAlert, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error" | "info";

export type ToastOptions = {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** e.g. { label: "Undo", onClick: undoAccept } */
  action?: { label: string; onClick: () => void };
  /** ms before auto-hide. Default 4000. Pass 0 to keep it until closed. */
  duration?: number;
};

type ToastItem = ToastOptions & { id: number };

type ToastContextValue = {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

/** Mounted once in the root layout. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextId++;
    // Keep at most 3 on screen; small phones don't have room for more.
    setToasts((list) => [...list.slice(-2), { ...options, id }]);
    return id;
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--spacing-touch-lg)+1rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:inset-x-auto lg:right-6 lg:bottom-6 lg:items-end"
      >
        {toasts.map((t) => (
          <ToastView key={t.id} item={t} dismiss={dismiss} />
        ))}
      </div>
    </ToastContext>
  );
}

/** const { toast } = useToast(); toast({ title: "Saved", tone: "success" }) */
export function useToast() {
  const ctx = use(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const toneIcon = {
  success: <Check aria-hidden />,
  error: <CircleAlert aria-hidden />,
  info: <Info aria-hidden />,
};

function ToastView({
  item,
  dismiss,
}: {
  item: ToastItem;
  dismiss: (id: number) => void;
}) {
  const { id, title, description, tone = "success", action, duration = 4000 } =
    item;
  const onDismiss = () => dismiss(id);

  useEffect(() => {
    if (!duration) return;
    const timer = setTimeout(() => dismiss(id), duration);
    return () => clearTimeout(timer);
  }, [duration, dismiss, id]);

  const isError = tone === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full max-w-md animate-toast-in items-center gap-3 rounded-card px-4 py-3 shadow-raised",
        isError
          ? "border border-status-cancelled-border bg-surface text-ink"
          : "bg-ink text-white",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-4",
          tone === "success" && "bg-whatsapp text-white",
          tone === "error" && "bg-status-cancelled-bg text-danger",
          tone === "info" && "bg-white/15 text-white",
        )}
      >
        {toneIcon[tone]}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{title}</p>
        {description ? (
          <p className={cn(isError ? "text-muted" : "text-white/75")}>
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <button
          type="button"
          onClick={() => {
            action.onClick();
            onDismiss();
          }}
          className={cn(
            "min-h-touch shrink-0 rounded-control px-3 text-sm font-bold",
            isError
              ? "text-brand-700 hover:bg-brand-50"
              : "text-urgent hover:bg-white/10",
          )}
        >
          {action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className={cn(
          "-mr-2 flex size-touch shrink-0 items-center justify-center rounded-control [&_svg]:size-4",
          isError ? "text-muted hover:bg-subtle" : "text-white/60 hover:bg-white/10",
        )}
      >
        <X aria-hidden />
      </button>
    </div>
  );
}
