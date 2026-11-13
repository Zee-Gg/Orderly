"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bot, Building2, LayoutDashboard, MessageCircle, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/restaurants", label: "Restaurants", icon: Building2 },
  { href: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/admin/ai-usage", label: "AI usage", icon: Bot },
  { href: "/admin/health", label: "Health", icon: Activity },
  { href: "/admin/settings", label: "Plans & settings", icon: Settings },
];

/** Tabs across the super admin pages. */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="-mx-4 -mt-2 flex gap-1 overflow-x-auto border-b border-line px-4 lg:-mx-8 lg:px-8">
      {LINKS.map((l) => {
        const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
        const Icon = l.icon;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex min-h-touch shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold",
              active ? "border-brand-700 text-brand-700" : "border-transparent text-muted hover:text-ink",
            )}
          >
            <Icon aria-hidden className="size-4" />
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
