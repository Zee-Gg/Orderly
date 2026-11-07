import {
  BookOpen,
  ChartColumn,
  ClipboardList,
  Flame,
  MessageCircle,
  Settings,
  Bike,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar. The rest go under "More". */
  inBottomNav: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/orders", label: "Orders", icon: ClipboardList, inBottomNav: true },
  { href: "/inbox", label: "Inbox", icon: MessageCircle, inBottomNav: true },
  // Full-screen kitchen display, lives outside the (dashboard) shell.
  { href: "/kitchen", label: "Kitchen", icon: Flame, inBottomNav: true },
  { href: "/menu", label: "Menu", icon: BookOpen, inBottomNav: true },
  { href: "/riders", label: "Riders", icon: Bike, inBottomNav: false },
  { href: "/customers", label: "Customers", icon: Users, inBottomNav: false },
  { href: "/reports", label: "Reports", icon: ChartColumn, inBottomNav: false },
  { href: "/settings", label: "Settings", icon: Settings, inBottomNav: false },
];

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
