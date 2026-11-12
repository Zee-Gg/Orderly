import "server-only";
import { getBranchMenu } from "@/lib/menu/pricing";
import { createClient } from "@/lib/supabase/server";
import type { CurrentContext } from "@/lib/auth/session";
import { menuImageOutdated, offerState, offerScheduleText, type OfferState } from "./knowledge";
import { BOT_MEDIA_BUCKET } from "./media-constants";
import { priceLabel } from "./tools/knowledge-tools";
import type { BotPaymentMethod } from "./types";

/**
 * Data for /settings/bot (Phase 7C). User client: RLS decides what is visible
 * (members read; owner/manager write).
 */

/** Price changes that make an uploaded menu image show old prices. */
export const PRICE_CHANGE_ACTIONS = ["menu_item.price_changed", "modifier_option.price_changed", "menu.bulk_price_update", "menu_item.created"];

export type MenuMediaRow = {
  id: string;
  type: "image" | "pdf";
  url: string;
  storagePath: string;
  fileName: string | null;
  sizeBytes: number | null;
  branchId: string | null;
  isActive: boolean;
  uploadedAt: string;
};

export type OfferRow = {
  id: string;
  branchId: string | null;
  title: string;
  titleUr: string | null;
  description: string | null;
  menuItemId: string;
  itemName: string | null;
  /** From the pricing engine (first branch), e.g. "Rs 1,250" or "from Rs 899". */
  price: string | null;
  itemAvailable: boolean;
  startsAt: string;
  endsAt: string | null;
  daysOfWeek: number[] | null;
  startTime: string | null;
  endTime: string | null;
  isActive: boolean;
  state: OfferState;
  schedule: string;
};

export type FaqRow = {
  id: string;
  question: string;
  answer: string;
  answerUr: string | null;
  keywords: string[];
  isActive: boolean;
};

export type BranchInfoRow = {
  id: string;
  name: string;
  address: string | null;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string | null;
  deliveryMinutes: number;
  prepMinutes: number;
};

export type PickerItem = { id: string; name: string; category: string; price: string | null; available: boolean };

export type BotKnowledge = {
  media: MenuMediaRow[];
  menuImageOutdated: boolean;
  offers: OfferRow[];
  faqs: FaqRow[];
  branches: BranchInfoRow[];
  restaurant: { mentionOfferOnGreeting: boolean; dineInAvailable: boolean; paymentMethods: BotPaymentMethod[]; timezone: string };
  items: PickerItem[];
  dealsCategoryId: string | null;
};

type Db = Awaited<ReturnType<typeof createClient>>;

/** Newest active menu image vs newest price change. Shared by /settings/bot and /menu. */
export async function getMenuImageOutdated(db: Db, restaurantId: string): Promise<boolean> {
  const [media, audit] = await Promise.all([
    db.from("menu_media").select("uploaded_at").eq("restaurant_id", restaurantId).eq("is_active", true).order("uploaded_at", { ascending: false }).limit(1),
    db
      .from("audit_logs")
      .select("created_at")
      .eq("restaurant_id", restaurantId)
      .in("action", PRICE_CHANGE_ACTIONS)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  return menuImageOutdated(media.data?.[0]?.uploaded_at ?? null, audit.data?.[0]?.created_at ?? null);
}

export async function getBotKnowledge(ctx: CurrentContext): Promise<BotKnowledge> {
  const db = await createClient();
  const rid = ctx.restaurant.id;
  const branchIds = ctx.branches.map((b) => b.id);
  const priceBranch = ctx.currentBranch?.id ?? branchIds[0];

  const [media, offers, faqs, restaurant, branches, menu, outdated] = await Promise.all([
    db.from("menu_media").select("*").eq("restaurant_id", rid).order("sort_order").order("uploaded_at"),
    db.from("offers").select("*").eq("restaurant_id", rid).order("sort_order").order("created_at"),
    db.from("restaurant_faqs").select("*").eq("restaurant_id", rid).order("sort_order").order("created_at"),
    db.from("restaurants").select("mention_offer_on_greeting, dine_in_available, payment_methods, timezone").eq("id", rid).single(),
    db
      .from("branches")
      .select("id, name, address, area, latitude, longitude, google_maps_url, delivery_minutes, default_prep_minutes")
      .in("id", branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at"),
    priceBranch ? getBranchMenu(db, rid, priceBranch) : Promise.resolve(null),
    getMenuImageOutdated(db, rid),
  ]);
  for (const r of [media, offers, faqs, restaurant, branches]) if (r.error) throw r.error;

  const timezone = restaurant.data!.timezone;
  const now = new Date();
  const items: PickerItem[] = [];
  const byId = new Map<string, PickerItem>();
  for (const c of menu?.categories ?? []) {
    for (const i of c.items) {
      const row = { id: i.id, name: i.name, category: c.name, price: priceLabel(i), available: i.isAvailable };
      items.push(row);
      byId.set(i.id, row);
    }
  }
  const dealsCategoryId = menu?.categories.find((c) => /deal/i.test(c.name))?.id ?? null;

  // Items not on this branch's menu (hidden/archived) still need a name in the offers list.
  const missing = (offers.data ?? []).map((o) => o.menu_item_id).filter((id) => !byId.has(id));
  const names = new Map<string, string>();
  if (missing.length) {
    const { data } = await db.from("menu_items").select("id, name").in("id", missing);
    for (const r of data ?? []) names.set(r.id, r.name);
  }

  return {
    media: (media.data ?? []).map((m) => ({
      id: m.id,
      type: m.type as "image" | "pdf",
      url: db.storage.from(BOT_MEDIA_BUCKET).getPublicUrl(m.storage_path).data.publicUrl,
      storagePath: m.storage_path,
      fileName: m.file_name,
      sizeBytes: m.size_bytes,
      branchId: m.branch_id,
      isActive: m.is_active,
      uploadedAt: m.uploaded_at,
    })),
    menuImageOutdated: outdated,
    offers: (offers.data ?? []).map((o) => {
      const item = byId.get(o.menu_item_id);
      const rec = {
        isActive: o.is_active,
        startsAt: o.starts_at,
        endsAt: o.ends_at,
        daysOfWeek: o.days_of_week,
        startTime: o.start_time,
        endTime: o.end_time,
      };
      return {
        id: o.id,
        branchId: o.branch_id,
        title: o.title,
        titleUr: o.title_ur,
        description: o.description,
        menuItemId: o.menu_item_id,
        itemName: item?.name ?? names.get(o.menu_item_id) ?? null,
        price: item?.price ?? null,
        itemAvailable: !!item?.available,
        ...rec,
        state: offerState(rec, now, timezone),
        schedule: offerScheduleText(rec),
      };
    }),
    faqs: (faqs.data ?? []).map((f) => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
      answerUr: f.answer_ur,
      keywords: f.keywords,
      isActive: f.is_active,
    })),
    branches: (branches.data ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      address: b.address,
      area: b.area,
      latitude: b.latitude,
      longitude: b.longitude,
      googleMapsUrl: b.google_maps_url,
      deliveryMinutes: b.delivery_minutes,
      prepMinutes: b.default_prep_minutes,
    })),
    restaurant: {
      mentionOfferOnGreeting: restaurant.data!.mention_offer_on_greeting,
      dineInAvailable: restaurant.data!.dine_in_available,
      paymentMethods: restaurant.data!.payment_methods as BotPaymentMethod[],
      timezone,
    },
    items,
    dealsCategoryId,
  };
}
