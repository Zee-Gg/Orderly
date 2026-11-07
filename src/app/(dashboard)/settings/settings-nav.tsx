"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MapPin, Store, Users } from "lucide-react";
import type { Action } from "@/lib/auth/permissions";
import { usePermission } from "@/lib/auth/permissions-context";
import { cn } from "@/lib/utils";

const LINKS: { href: string; label: string; icon: typeof Store; permission: Action }[] = [
  { href: "/settings/restaurant", label: "Restaurant", icon: Store, permission: "settings.edit" },
  { href: "/settings/branches", label: "Branches", icon: MapPin, permission: "branches.manage" },
  { href: "/settings/staff", label: "Staff", icon: Users, permission: "staff.view" },
];

function NavLink({ link }: { link: (typeof LINKS)[number] }) {
  const pathname = usePathname();
  const allowed = usePermission(link.permission);
  if (!allowed) return null;
  const active = pathname.startsWith(link.href);
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "-mb-px flex min-h-touch shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold",
        active ? "border-brand-700 text-brand-700" : "border-transparent text-muted hover:text-ink",
      )}
    >
      <Icon aria-hidden className="size-4" />
      {link.label}
    </Link>
  );
}

export function SettingsNav() {
  return (
    <nav aria-label="Settings" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 lg:mx-0 lg:px-0">
      {LINKS.map((link) => (
        <NavLink key={link.href} link={link} />
      ))}
    </nav>
  );
}
