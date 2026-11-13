import { connection } from "next/server";
import { revalidatePublicMenu } from "@/lib/menu/public-cache";
import { safeEqual } from "@/lib/whatsapp/signature";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/cron/maintenance — called by Vercel Cron (vercel.json) with
 * `Authorization: Bearer <CRON_SECRET>`. The frequent jobs run in Postgres
 * (pg_cron); this is the daily backup run of the same jobs PLUS what needs
 * app code: clearing the cached menu page of restaurants that were just
 * suspended, so customers see "not available" right away.
 */
export const maxDuration = 60;

export async function GET(req: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const db = createAdminClient();
  try {
    const { data, error } = await db.rpc("run_maintenance_jobs");
    if (error) throw error;

    // Menu pages are cached up to an hour: refresh the ones whose access changed today.
    const since = new Date(Date.now() - 26 * 3600_000).toISOString();
    const { data: changed } = await db.from("restaurant_subscriptions").select("restaurant_id").gte("updated_at", since);
    for (const r of changed ?? []) revalidatePublicMenu(r.restaurant_id);

    await db.rpc("record_app_job", { p_job: "app_maintenance", p_ok: true, p_result: { menus_refreshed: changed?.length ?? 0 } });
    return Response.json({ ok: true, jobs: data, menusRefreshed: changed?.length ?? 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron] maintenance failed", message);
    await db.rpc("record_app_job", { p_job: "app_maintenance", p_ok: false, p_result: {}, p_error: message.slice(0, 2000) });
    return Response.json({ ok: false }, { status: 500 });
  }
}
