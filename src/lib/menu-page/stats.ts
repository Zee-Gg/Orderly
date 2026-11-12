import "server-only";
import { createClient } from "@/lib/supabase/server";
import { localDate, todayRange } from "@/lib/time";

/**
 * Menu page funnel for owners (Phase 8): views → carts sent → carts loaded in
 * WhatsApp → confirmed orders. User client (RLS: owner/manager read).
 */
export type MenuPageStats = {
  viewsToday: number;
  viewsWeek: number;
  cartsWeek: number;
  cartsUsedWeek: number;
  ordersWeek: number;
};

export async function getMenuPageStats(restaurantId: string, timeZone: string, now: Date = new Date()): Promise<MenuPageStats> {
  const db = await createClient();
  const today = localDate(now, timeZone);
  const weekAgoDate = localDate(new Date(now.getTime() - 6 * 86400_000), timeZone);
  const weekStart = new Date(todayRange(timeZone, now).start.getTime() - 6 * 86400_000).toISOString();

  const [views, carts, orders] = await Promise.all([
    db.from("menu_page_views").select("day, views").eq("restaurant_id", restaurantId).gte("day", weekAgoDate),
    db.from("cart_drafts").select("used_at").eq("restaurant_id", restaurantId).gte("created_at", weekStart),
    db
      .from("bot_sessions")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .not("cart_draft_id", "is", null)
      .not("order_id", "is", null)
      .gte("created_at", weekStart),
  ]);
  const rows = views.data ?? [];
  return {
    viewsToday: rows.filter((r) => r.day === today).reduce((n, r) => n + r.views, 0),
    viewsWeek: rows.reduce((n, r) => n + r.views, 0),
    cartsWeek: carts.data?.length ?? 0,
    cartsUsedWeek: (carts.data ?? []).filter((c) => c.used_at).length,
    ordersWeek: orders.count ?? 0,
  };
}
