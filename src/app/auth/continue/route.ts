import { NextResponse, type NextRequest } from "next/server";
import { getHomePath } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/validation/auth";

/** Steps that must be finished before going anywhere else. */
const SETUP_PATHS = ["/login", "/change-password", "/onboarding", "/select-restaurant"];

/**
 * The single "where should this user go now?" decision, used after login,
 * signup, OAuth and password changes:
 *   no session → /login · temporary password → /change-password
 *   super admin → /admin · no restaurant → /onboarding
 *   several restaurants → /select-restaurant · otherwise the role's home.
 * A safe ?next= wins once setup is complete.
 */
export async function GET(request: NextRequest) {
  const home = await getHomePath();
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const target = next && next !== "/" && !SETUP_PATHS.includes(home) ? next : home;
  return NextResponse.redirect(new URL(target, request.url));
}
