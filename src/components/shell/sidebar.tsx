"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { AccountCard } from "./account-card";
import { BranchSwitcher } from "./branch-switcher";
import { isActive, visibleNavItems } from "./nav-items";
import { RestaurantBrand } from "./restaurant-brand";
import type { ShellData } from "./shell-data";

/** Desktop left sidebar (lg and up). Shows only pages the role may open. */
export function Sidebar({ data, className }: { data: ShellData; className?: string }) {
  const pathname = usePathname();
  const items = visibleNavItems(data.role);

  return (
    <aside
      className={cn(
        "flex w-sidebar flex-col gap-6 overflow-y-auto border-r border-line bg-surface px-4 py-6",
        className,
      )}
    >
      <RestaurantBrand
        className="px-1"
        name={data.restaurant.name}
        logoUrl={data.restaurant.logoUrl}
        subtitle="by Orderly"
      />
      <BranchSwitcher
        branches={data.branches}
        currentBranchId={data.currentBranchId}
        canSwitch={data.canSwitchBranch}
      />

      <nav aria-label="Main" className="flex flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-12 items-center gap-3 rounded-control px-3 text-base font-medium transition-colors",
                active ? "bg-brand-50 font-semibold text-brand-700" : "text-ink hover:bg-subtle",
              )}
            >
              <Icon aria-hidden className="size-5 shrink-0" />
              <span className="flex-1">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto">
        <AccountCard data={data} />
      </div>
    </aside>
  );
}
