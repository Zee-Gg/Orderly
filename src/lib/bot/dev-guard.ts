import "server-only";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { devToolsEnabled } from "./playground-shared";

/** Dev tool routes: development only + super admin. Returns an error response, or null when allowed. */
export async function devToolGuard(): Promise<Response | null> {
  await connection(); // decide per request, never at build time
  if (!devToolsEnabled()) return new Response("Not found", { status: 404 });
  const user = await getCurrentUser();
  if (!user?.profile.is_super_admin) return Response.json({ error: "Super admin only" }, { status: 403 });
  return null;
}
