import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { offerState, type OfferRecord } from "@/lib/bot/knowledge";
import { getBranchMenu, type BranchMenuItem } from "@/lib/menu/pricing";
import { publicMenuTag } from "@/lib/menu/public-cache";
import { formatDayHours, isOpenAt, nextOpening, toOpeningHours, weekdayAt } from "@/lib/opening-hours";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_TIMEZONE } from "@/lib/time";

/**
 * Data for the public menu page /m/[slug] (Phase 8).
 *  - loadPublicMenu(): CACHED per restaurant (tag publicMenuTag, cleared when
 *    the menu, stock, offers, branches or WhatsApp number change). Prices
 *    come from the pricing engine (getBranchMenu).
 *  - pageState(): per request — open/closed now, today's hours, active offers.
 */

/** What the browser gets for one item: no aliases or internal fields. */
export type PageItem = Pick<
  BranchMenuItem,
  "id" | "name" | "nameUr" | "description" | "descriptionUr" | "imageUrl" | "isAvailable" | "price" | "fromPrice" | "sizes" | "groups" | "removableOptions"
> & { bestseller: boolean };

export type PageCategory = { id: string; name: string; nameUr: string | null; items: PageItem[] };

export type PublicBranch = {
  id: string;
  name: string;
  area: string | null;
  address: string | null;
  isOpen: boolean;
  openingHours: unknown;
  deliveryFee: number;
  minimumOrder: number;
  prepMinutes: number;
  deliveryMinutes: number;
};

export type PublicMenu = {
  restaurant: { id: string; name: string; slug: string; logoUrl: string | null; timezone: string };
  branches: PublicBranch[];
  branchId: string;
  whatsappNumber: string | null;
  offers: Pick<OfferRecord, "id" | "branchId" | "title" | "titleUr" | "description" | "menuItemId" | "startsAt" | "endsAt" | "daysOfWeek" | "startTime" | "endTime">[];
  categories: PageCategory[];
  /** Phase 9: delivery areas of this branch (fee depends on the area). */
  zones: { id: string; name: string; fee: number; minimumOrder: number }[];
};

type InfoRow = {
  restaurant: { id: string; name: string; slug: string; logo_url: string | null; timezone: string | null };
  branches: {
    id: string;
    name: string;
    area: string | null;
    address: string | null;
    is_open: boolean;
    opening_hours: unknown;
    default_delivery_fee: number;
    minimum_order: number;
    default_prep_minutes: number;
    delivery_minutes: number;
  }[];
  branch_id: string;
  whatsapp_number: string | null;
  offers: {
    id: string;
    branch_id: string | null;
    title: string;
    title_ur: string | null;
    description: string | null;
    menu_item_id: string;
    starts_at: string;
    ends_at: string | null;
    days_of_week: number[] | null;
    start_time: string | null;
    end_time: string | null;
  }[];
  bestseller_ids: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadPublicMenu(slug: string, branchId: string | null): Promise<PublicMenu | null> {
  "use cache";
  const db = createAdminClient();
  const { data, error } = await db.rpc("get_public_menu_info", {
    p_slug: slug.slice(0, 60),
    ...(branchId && UUID.test(branchId) ? { p_branch_id: branchId } : {}),
  });
  if (error) throw new Error(`public menu: ${error.message}`);
  const info = data as unknown as InfoRow | null;
  if (!info || !info.branch_id) {
    cacheLife({ stale: 30, revalidate: 60, expire: 300 }); // a new restaurant shows up quickly
    return null;
  }
  cacheTag(publicMenuTag(info.restaurant.id));
  cacheLife({ stale: 300, revalidate: 900, expire: 3600 });

  const [menu, zoneRows] = await Promise.all([
    getBranchMenu(db, info.restaurant.id, info.branch_id),
    db
      .from("delivery_zones")
      .select("id, name, delivery_fee, minimum_order")
      .eq("restaurant_id", info.restaurant.id)
      .eq("branch_id", info.branch_id)
      .eq("is_active", true)
      .order("sort_order"),
  ]);
  const best = new Set(info.bestseller_ids);
  return {
    restaurant: {
      id: info.restaurant.id,
      name: info.restaurant.name,
      slug: info.restaurant.slug,
      logoUrl: info.restaurant.logo_url,
      timezone: info.restaurant.timezone || DEFAULT_TIMEZONE,
    },
    branches: info.branches.map((b) => ({
      id: b.id,
      name: b.name,
      area: b.area,
      address: b.address,
      isOpen: b.is_open,
      openingHours: b.opening_hours,
      deliveryFee: b.default_delivery_fee,
      minimumOrder: b.minimum_order,
      prepMinutes: b.default_prep_minutes,
      deliveryMinutes: b.delivery_minutes,
    })),
    branchId: info.branch_id,
    whatsappNumber: info.whatsapp_number,
    offers: info.offers
      .filter((o) => !o.branch_id || o.branch_id === info.branch_id)
      .map((o) => ({
        id: o.id,
        branchId: o.branch_id,
        title: o.title,
        titleUr: o.title_ur,
        description: o.description,
        menuItemId: o.menu_item_id,
        startsAt: o.starts_at,
        endsAt: o.ends_at,
        daysOfWeek: o.days_of_week,
        startTime: o.start_time,
        endTime: o.end_time,
      })),
    zones: (zoneRows.data ?? []).map((z) => ({ id: z.id, name: z.name, fee: z.delivery_fee, minimumOrder: z.minimum_order })),
    categories: menu.categories.map((c) => ({
      id: c.id,
      name: c.name,
      nameUr: c.nameUr,
      items: c.items.map((i) => ({
        id: i.id,
        name: i.name,
        nameUr: i.nameUr,
        description: i.description,
        descriptionUr: i.descriptionUr,
        imageUrl: i.imageUrl,
        isAvailable: i.isAvailable,
        price: i.price,
        fromPrice: i.fromPrice,
        sizes: i.sizes,
        groups: i.groups,
        removableOptions: i.removableOptions,
        bestseller: best.has(i.id),
      })),
    })),
  };
}

export type PageState = {
  isOpen: boolean;
  /** "12 PM – 11 PM" or "Closed today". */
  todayHours: string;
  /** "12 PM" or "Tue 12 PM" when closed. */
  opensAt: string | null;
  /** Rough delivery minutes, e.g. [50, 60]. */
  deliveryRange: [number, number];
  prepMinutes: number;
  /** Offers active right now whose item can be ordered (ids). */
  activeOfferIds: string[];
};

/** Live state for this request (not cached). */
export function pageState(data: PublicMenu, now: Date = new Date()): PageState {
  const branch = data.branches.find((b) => b.id === data.branchId)!;
  const tz = data.restaurant.timezone;
  const hours = toOpeningHours(branch.openingHours);
  const isOpen = branch.isOpen && isOpenAt(hours, now, tz);
  const today = hours[weekdayAt(now, tz)];
  const items = new Map(data.categories.flatMap((c) => c.items).map((i) => [i.id, i]));
  const total = branch.prepMinutes + branch.deliveryMinutes;
  return {
    isOpen,
    todayHours: today.closed ? "Closed today" : formatDayHours(today),
    opensAt: isOpen ? null : branch.isOpen ? nextOpening(hours, now, tz) : null,
    deliveryRange: [total, total + 10],
    prepMinutes: branch.prepMinutes,
    activeOfferIds: data.offers
      .filter((o) => items.get(o.menuItemId)?.isAvailable)
      .filter((o) => offerState({ ...o, isActive: true }, now, tz) === "active")
      .map((o) => o.id),
  };
}
