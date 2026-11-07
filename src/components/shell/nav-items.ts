import {
  Bike,
  BookOpen,
  ChartColumn,
  ClipboardList,
  Flame,
  MessageCircle,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { can, type Action, type Role } from "@/lib/auth/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Needed to see this page. The page itself re-checks on the server. */
  permission: Action;
  /** Shown in the mobile bottom bar. The rest go under "More". */
  inBottomNav: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/orders", label: "Orders", icon: ClipboardList, permission: "orders.view", inBottomNav: true },
  { href: "/inbox", label: "Inbox", icon: MessageCircle, permission: "inbox.access", inBottomNav: true },
  // Full-screen kitchen display, lives outside the (dashboard) shell.
  { href: "/kitchen", label: "Kitchen", icon: Flame, permission: "kitchen.view", inBottomNav: true },
  { href: "/menu", label: "Menu", icon: BookOpen, permission: "menu.view", inBottomNav: true },
  { href: "/riders", label: "Riders", icon: Bike, permission: "riders.view", inBottomNav: false },
  { href: "/customers", label: "Customers", icon: Users, permission: "customers.view", inBottomNav: false },
  { href: "/reports", label: "Reports", icon: ChartColumn, permission: "reports.view", inBottomNav: false },
  { href: "/settings", label: "Settings", icon: Settings, permission: "settings.view", inBottomNav: false },
];

/** Nav items this role may see. */
export function visibleNavItems(role: Role) {
  return NAV_ITEMS.filter((item) => can(role, item.permission));
}

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
