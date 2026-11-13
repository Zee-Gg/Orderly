import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { toPlan, type Plan } from "@/lib/billing/core";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Public platform info for the landing page (Phase 12): active plans and the
 * sales WhatsApp number. Cached; cleared when plans/settings change in /admin.
 */
export const PLATFORM_TAG = "platform-public";

export function revalidatePlatform() {
  revalidateTag(PLATFORM_TAG, { expire: 0 });
}

export type PublicPlatform = { plans: Plan[]; salesWhatsapp: string | null; supportPhone: string | null };

export async function loadPublicPlatform(): Promise<PublicPlatform> {
  "use cache";
  cacheTag(PLATFORM_TAG);
  cacheLife({ stale: 300, revalidate: 3600, expire: 86400 });
  const db = createAdminClient();
  const [plans, settings] = await Promise.all([
    db
      .from("plans")
      .select("id, name, description, monthly_price, max_branches, max_orders_per_month, max_bot_conversations_per_month, is_active, sort_order")
      .eq("is_active", true)
      .order("sort_order")
      .order("monthly_price"),
    db.from("platform_settings").select("sales_whatsapp, support_phone").maybeSingle(),
  ]);
  return {
    plans: (plans.data ?? []).map(toPlan),
    salesWhatsapp: settings.data?.sales_whatsapp ?? null,
    supportPhone: settings.data?.support_phone ?? null,
  };
}
