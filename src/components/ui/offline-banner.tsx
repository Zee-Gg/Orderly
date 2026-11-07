"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** True when the browser reports a network connection. */
export function useOnline() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true, // assume online during server render
  );
}

/**
 * Dark bar under the top bar, shown only when the device is offline.
 * `forceShow` is for previews (e.g. /dev/components).
 */
export function OfflineBanner({
  forceShow = false,
  className,
}: {
  forceShow?: boolean;
  className?: string;
}) {
  const online = useOnline();
  if (online && !forceShow) return null;

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-3 rounded-card bg-ink px-4 py-3 text-sm text-white",
        className,
      )}
    >
      <WifiOff aria-hidden className="size-5 shrink-0 text-urgent" />
      <p className="min-w-0 flex-1">
        <span className="font-bold">No internet — reconnecting…</span>{" "}
        <span className="text-white/80">
          Your actions will be saved and sent when you’re back online.
        </span>
      </p>
      <span className="hidden shrink-0 font-semibold text-urgent sm:inline">
        Trying again
      </span>
    </div>
  );
}
