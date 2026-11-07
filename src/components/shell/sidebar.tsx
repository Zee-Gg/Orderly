"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { BranchSwitcher } from "./branch-switcher";
import { isActive, NAV_ITEMS } from "./nav-items";
import { RestaurantBrand } from "./restaurant-brand";

/** Desktop left sidebar (lg and up). */
export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "flex w-sidebar flex-col gap-6 border-r border-line bg-surface px-4 py-6",
        className,
      )}
    >
      <RestaurantBrand className="px-1" />
      <BranchSwitcher />

      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-12 items-center gap-3 rounded-control px-3 text-base font-medium transition-colors",
                active
                  ? "bg-brand-50 font-semibold text-brand-700"
                  : "text-ink hover:bg-subtle",
              )}
            >
              <Icon aria-hidden className="size-5 shrink-0" />
              <span className="flex-1">{label}</span>
              {/* Count badges (new orders, unread chats) arrive with real data. */}
            </Link>
          );
        })}
      </nav>

      {/* WhatsApp connection status — placeholder until WhatsApp is connected. */}
      <div className="mt-auto flex gap-3 rounded-card border border-line bg-page p-3">
        <MessageCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
        <div className="text-sm">
          <p className="font-semibold text-ink">WhatsApp not connected</p>
          <p className="text-muted">Connect your number in Settings.</p>
        </div>
      </div>
    </aside>
  );
}
