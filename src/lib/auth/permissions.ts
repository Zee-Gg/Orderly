import type { Database } from "@/types/database";

export type Role = Database["public"]["Enums"]["member_role"];

export const ROLES: readonly Role[] = ["owner", "manager", "staff", "kitchen", "rider"];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff (cashier)",
  kitchen: "Kitchen",
  rider: "Rider",
};

/** Roles an owner can give to staff. "owner" is never assignable. */
export const ASSIGNABLE_ROLES = ["manager", "staff", "kitchen", "rider"] as const satisfies readonly Role[];

const MANAGEMENT: readonly Role[] = ["owner", "manager"];
const FRONT_OF_HOUSE: readonly Role[] = ["owner", "manager", "staff"];

/**
 * THE permissions matrix. Every server action / route handler checks one of
 * these with requirePermission(); the UI uses the same table to hide buttons.
 * RLS in the database is the final guard — keep the two consistent.
 */
export const PERMISSIONS = {
  "orders.view": FRONT_OF_HOUSE,
  "orders.create": FRONT_OF_HOUSE,
  "orders.edit": FRONT_OF_HOUSE,
  "orders.cancel": MANAGEMENT,
  "orders.refund": ["owner"],
  "kitchen.view": ["owner", "manager", "staff", "kitchen"],
  "deliveries.view": ["rider"],
  "menu.view": FRONT_OF_HOUSE,
  "menu.edit": MANAGEMENT,
  /** In stock / out of stock at a branch (DB: set_item_stock RPC). */
  "menu.stock": ["owner", "manager", "staff", "kitchen"],
  "prices.edit": MANAGEMENT,
  "riders.view": FRONT_OF_HOUSE,
  "riders.manage": MANAGEMENT,
  "riders.assign": FRONT_OF_HOUSE,
  "customers.view": FRONT_OF_HOUSE,
  "inbox.access": FRONT_OF_HOUSE,
  "reports.view": MANAGEMENT,
  "settings.view": MANAGEMENT,
  "settings.edit": ["owner"],
  "branches.manage": MANAGEMENT,
  "branches.toggle_open": MANAGEMENT,
  "staff.view": MANAGEMENT,
  "staff.manage": ["owner"],
  "audit.view": MANAGEMENT,
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return (PERMISSIONS[action] as readonly Role[]).includes(role);
}

/** Roles that use the staff dashboard (sidebar shell). */
export const DASHBOARD_ROLES: readonly Role[] = FRONT_OF_HOUSE;

/** Where each role lands after login. */
export function homePathForRole(role: Role): string {
  if (role === "kitchen") return "/kitchen";
  if (role === "rider") return "/rider";
  return "/orders";
}
