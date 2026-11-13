import { z } from "zod";
import { clientIp, readJson } from "@/lib/menu-page/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/public/menu-views — +1 menu page view for today (the page sends
 * it once per visit). Public; the RPC ignores unknown or inactive restaurants.
 */
const schema = z.object({ restaurantId: z.uuid(), branchId: z.uuid() });

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await readJson(req, 1024));
    if (!parsed.success) return new Response(null, { status: 400 });
    // Quietly ignore floods (the page doesn't care about the answer).
    if (!(await rateLimit("menuView", clientIp(req.headers)))) return new Response(null, { status: 204 });
    const { error } = await createAdminClient().rpc("record_menu_page_view", {
      p_restaurant_id: parsed.data.restaurantId,
      p_branch_id: parsed.data.branchId,
    });
    if (error) console.error("[menu-page] view not counted", error.message);
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 400 });
  }
}
