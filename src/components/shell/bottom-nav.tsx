"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { useOrdersLiveOptional } from "@/components/orders/live-provider";
import { cn } from "@/lib/utils";
import { Drawer } from "@/components/ui/drawer";
import { AccountCard } from "./account-card";
import { isActive, visibleNavItems } from "./nav-items";
import type { ShellData } from "./shell-data";

const tabClasses = (active: boolean) =>
  cn(
    "flex h-touch-lg flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors",
    active ? "font-bold text-brand-700" : "text-muted",
  );

/** Mobile bottom navigation (below lg). Extra pages + account live under "More". */
export function BottomNav({ data, className }: { data: ShellData; className?: string }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = visibleNavItems(data.role);
  const needsStaff = useOrdersLiveOptional()?.snapshot.needsStaff?.length ?? 0;
  const primary = items.filter((i) => i.inBottomNav);
  const more = items.filter((i) => !i.inBottomNav);
  const moreActive = more.some((i) => isActive(pathname, i.href));

  return (
    <>
      <nav
        aria-label="Main"
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]",
          className,
        )}
      >
        {primary.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={tabClasses(active)}
            >
              <span className="relative">
                <Icon aria-hidden className="size-6" />
                {href === "/inbox" && needsStaff > 0 ? (
                  <span
                    className="absolute -top-1.5 -right-2.5 min-w-5 rounded-full bg-danger px-1 text-center text-[11px] font-bold leading-5 text-white"
                    aria-label={`${needsStaff} chat${needsStaff === 1 ? "" : "s"} need staff`}
                  >
                    {needsStaff}
                  </span>
                ) : null}
              </span>
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          className={tabClasses(moreActive)}
        >
          <Ellipsis aria-hidden className="size-6" />
          More
        </button>
      </nav>

      <Drawer open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <ul className="flex flex-col gap-1">
          {more.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-touch-lg items-center gap-3 rounded-control px-3 text-base font-medium",
                    active ? "bg-brand-50 text-brand-700" : "text-ink hover:bg-subtle",
                  )}
                >
                  <Icon aria-hidden className="size-6" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-6">
          <AccountCard data={data} />
        </div>
      </Drawer>
    </>
  );
}
