import { Bell, CircleUser } from "lucide-react";
import { cn } from "@/lib/utils";
import { BranchSwitcher } from "./branch-switcher";
import { OpenToggle } from "./open-toggle";
import { RestaurantBrand } from "./restaurant-brand";

/** Placeholder quick stat. Values come from the database in a later phase. */
function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "pending";
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-card px-3 py-2 lg:px-4",
        tone === "pending"
          ? "border border-status-awaiting-border bg-status-awaiting-bg/70"
          : "bg-subtle",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1.5 truncate text-xs font-medium lg:text-sm",
          tone === "pending" ? "text-status-awaiting-fg" : "text-muted",
        )}
      >
        {tone === "pending" ? (
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-urgent" />
        ) : null}
        {label}
      </p>
      <p
        className={cn(
          "truncate text-xl font-bold lg:text-2xl",
          tone === "pending" ? "text-status-awaiting-fg" : "text-ink",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function NotificationBell() {
  return (
    <button
      type="button"
      aria-label="Notifications"
      className="relative flex size-touch-lg shrink-0 items-center justify-center rounded-panel border border-line bg-surface text-ink hover:bg-subtle"
    >
      <Bell aria-hidden className="size-6" />
      {/* Unread count dot goes here once notifications exist. */}
    </button>
  );
}

export function TopBar() {
  return (
    <header className="border-b border-line bg-surface">
      {/* Mobile: brand + branch + bell */}
      <div className="flex items-center gap-3 px-4 pt-4 lg:hidden">
        <RestaurantBrand
          className="flex-1"
          subtitle={<BranchSwitcher variant="inline" />}
        />
        <NotificationBell />
      </div>

      <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:gap-4 lg:px-8 lg:py-4">
        <OpenToggle className="lg:w-96" />

        <div className="grid grid-cols-3 gap-2 lg:flex lg:gap-3">
          <StatTile label="Orders today" value="—" />
          <StatTile label="Sales today" value="—" />
          <StatTile label="Pending" value="—" tone="pending" />
        </div>

        <div className="ml-auto hidden items-center gap-3 lg:flex">
          <NotificationBell />
          <span
            aria-label="Your account"
            role="img"
            className="flex size-touch-lg items-center justify-center rounded-full bg-brand-50 text-brand-700"
          >
            <CircleUser aria-hidden className="size-7" />
          </span>
        </div>
      </div>
    </header>
  );
}
