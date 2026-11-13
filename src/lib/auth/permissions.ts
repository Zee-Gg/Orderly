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
  /** Edit items in New/Accepted orders. */
  "orders.edit": FRONT_OF_HOUSE,
  /** Edit an order the kitchen is already preparing. */
  "orders.edit_preparing": MANAGEMENT,
  /** Move orders along (kitchen: only start/finish cooking — see orders/status.ts). */
  "orders.update_status": ["owner", "manager", "staff", "kitchen"],
  /** Reject / cancel New and Accepted orders. */
  "orders.cancel": FRONT_OF_HOUSE,
  /** Cancel orders that are preparing or ready. */
  "orders.cancel_late": MANAGEMENT,
  "orders.hold": FRONT_OF_HOUSE,
  "orders.discount": MANAGEMENT,
  /** Place an order for a blocked customer (with a reason). */
  "orders.override_block": MANAGEMENT,
  "orders.refund": ["owner"],
  /** Kitchen slip (no prices, no phone/address). */
  "orders.print_kot": ["owner", "manager", "staff", "kitchen"],
  /** Customer bill (prices, phone, address). */
  "orders.print_bill": FRONT_OF_HOUSE,
  /** Mark cash received / transfer verified. */
  "payments.record": FRONT_OF_HOUSE,
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
  /** Delivery zones, radius, unlisted-area rule (/settings/delivery). */
  "delivery.manage": MANAGEMENT,
  /** Type a delivery fee different from the area's fee on the order screen. */
  "orders.delivery_fee": MANAGEMENT,
  "customers.view": FRONT_OF_HOUSE,
  /** Notes and tags. */
  "customers.edit": FRONT_OF_HOUSE,
  "customers.block": MANAGEMENT,
  "inbox.access": FRONT_OF_HOUSE,
  /** Turn the AI bot back on for a chat it handed to staff. */
  "inbox.bot_toggle": FRONT_OF_HOUSE,
  /** Reply to customers from the inbox (takes the chat over from the bot). */
  "inbox.reply": FRONT_OF_HOUSE,
  /** /settings/quick-replies */
  "inbox.quick_replies": MANAGEMENT,
  /** What the bot knows: menu images, offers, FAQs, location (/settings/bot). */
  "bot.manage": MANAGEMENT,
  "reports.view": MANAGEMENT,
  "settings.view": MANAGEMENT,
  "settings.edit": ["owner"],
  "branches.manage": MANAGEMENT,
  "branches.toggle_open": MANAGEMENT,
  "staff.view": MANAGEMENT,
  "staff.manage": ["owner"],
  "audit.view": MANAGEMENT,
  /** Plan, payments, receipts (/settings/billing). Works while suspended. */
  "billing.view": ["owner"],
  /** Download all restaurant data as CSV (/settings/data). */
  "data.export": ["owner"],
  /** Delete a customer's personal data (privacy request). */
  "customers.delete": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;

/** What still works while the restaurant is suspended (unpaid). */
export const SUSPENDED_ALLOWED: readonly Action[] = ["billing.view"];

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
