import { connection } from "next/server";
import { clientIp } from "@/lib/menu-page/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/health — for an uptime monitor (UptimeRobot). Checks that the
 * database answers. Says only ok/error: no versions, no details.
 */
export async function GET(req: Request) {
  await connection();
  if (!(await rateLimit("health", clientIp(req.headers)))) {
    return Response.json({ status: "ok", note: "rate limited" }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  try {
    const { error } = await createAdminClient().from("platform_settings").select("id").limit(1);
    if (error) throw error;
    return Response.json({ status: "ok", db: "ok", ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[health] database check failed", err instanceof Error ? err.message : err);
    return Response.json({ status: "error", db: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
