import { Bell } from "lucide-react";
import { LiveStats } from "@/components/orders/live-alerts";
import { BranchSwitcher } from "./branch-switcher";
import { OpenToggle } from "./open-toggle";
import { RestaurantBrand } from "./restaurant-brand";
import type { ShellData } from "./shell-data";

function NotificationBell() {
  return (
    <button
      type="button"
      aria-label="Notifications"
      className="relative flex size-touch-lg shrink-0 items-center justify-center rounded-panel border border-line bg-surface text-ink hover:bg-subtle"
    >
      <Bell aria-hidden className="size-6" />
    </button>
  );
}

export function TopBar({ data }: { data: ShellData }) {
  return (
    <header className="border-b border-line bg-surface">
      {/* Mobile: brand + branch + bell */}
      <div className="flex items-center gap-3 px-4 pt-4 lg:hidden">
        <RestaurantBrand
          className="flex-1"
          name={data.restaurant.name}
          logoUrl={data.restaurant.logoUrl}
          subtitle={
            <BranchSwitcher
              variant="inline"
              branches={data.branches}
              currentBranchId={data.currentBranchId}
              canSwitch={data.canSwitchBranch}
            />
          }
        />
        <NotificationBell />
      </div>

      <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:gap-4 lg:px-8 lg:py-4">
        <OpenToggle
          className="lg:w-96"
          branch={data.currentBranch}
          canToggle={data.canToggleOpen}
        />

        <LiveStats />

        <div className="ml-auto hidden items-center gap-3 lg:flex">
          <NotificationBell />
          <span
            role="img"
            aria-label={`Signed in as ${data.user.name}`}
            className="flex size-touch-lg items-center justify-center rounded-full bg-brand-100 text-base font-bold text-brand-800"
          >
            {data.user.initials}
          </span>
        </div>
      </div>
    </header>
  );
}
