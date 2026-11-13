import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Onboarding checklist (Phase 12): auto-checked from real data, shown to the
 * owner (dashboard) and the super admin (/admin/restaurants/[id]).
 * Pass the owner's user client (RLS) or the admin client after requireSuperAdmin.
 */
export type ChecklistStep = { key: string; label: string; done: boolean; href: string; hint: string };
export type Checklist = { steps: ChecklistStep[]; done: number; total: number; complete: boolean };

type Db = SupabaseClient<Database>;

export async function getOnboardingChecklist(db: Db, restaurantId: string): Promise<Checklist> {
  const count = (res: { count: number | null }) => res.count ?? 0;
  const head = { count: "exact" as const, head: true };

  const [restaurant, items, wa, zones, riders, printed, faqs, media, finished, deliveryOrders] = await Promise.all([
    db.from("restaurants").select("name, phone, city, bill_header").eq("id", restaurantId).maybeSingle(),
    db.from("menu_items").select("id", head).eq("restaurant_id", restaurantId).is("archived_at", null),
    db.from("whatsapp_accounts").select("id", head).eq("restaurant_id", restaurantId).eq("is_active", true),
    db.from("delivery_zones").select("id", head).eq("restaurant_id", restaurantId).eq("is_active", true),
    db.from("rider_profiles").select("id", head).eq("restaurant_id", restaurantId).eq("is_active", true),
    db.from("order_events").select("id", head).eq("restaurant_id", restaurantId).eq("event_type", "printed"),
    db.from("restaurant_faqs").select("id", head).eq("restaurant_id", restaurantId).eq("is_active", true),
    db.from("menu_media").select("id", head).eq("restaurant_id", restaurantId).eq("is_active", true),
    db.from("orders").select("id", head).eq("restaurant_id", restaurantId).in("status", ["delivered", "completed"]),
    db.from("orders").select("id", head).eq("restaurant_id", restaurantId).eq("order_type", "delivery"),
  ]);

  const r = restaurant.data;
  const usesDelivery = count(zones) > 0 || count(deliveryOrders) > 0;

  const steps: ChecklistStep[] = [
    {
      key: "profile",
      label: "Restaurant profile done",
      done: !!(r?.name && r.phone && r.city),
      href: "/settings/restaurant",
      hint: "Name, phone number and city.",
    },
    { key: "menu", label: "Menu has at least 5 items", done: count(items) >= 5, href: "/menu", hint: `${count(items)} item(s) so far.` },
    { key: "whatsapp", label: "WhatsApp connected", done: count(wa) > 0, href: "/settings/whatsapp", hint: "We connect your number for you." },
    { key: "zones", label: "At least one delivery area", done: count(zones) > 0, href: "/settings/delivery", hint: "Areas, fees and minimum order." },
    {
      key: "riders",
      label: "At least one rider",
      done: !usesDelivery || count(riders) > 0,
      href: "/riders",
      hint: usesDelivery ? "Add riders so they can see their deliveries." : "Not needed: no delivery yet.",
    },
    {
      key: "printing",
      label: "Printing set up",
      done: !!r?.bill_header || count(printed) > 0,
      href: "/settings/printing",
      hint: "Add a bill header or print a test slip.",
    },
    {
      key: "bot",
      label: "Bot knows your restaurant",
      done: count(faqs) > 0 || count(media) > 0,
      href: "/settings/bot",
      hint: "At least one question/answer or a menu photo.",
    },
    { key: "test_order", label: "First test order completed", done: count(finished) > 0, href: "/orders/new", hint: "Make one order and mark it delivered/completed." },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, complete: done === steps.length };
}
