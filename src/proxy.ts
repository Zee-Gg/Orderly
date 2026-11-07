import type { NextRequest } from "next/server";
import { redirectWithCookies, updateSession } from "@/lib/supabase/proxy";

/** Pages for signed-out visitors. Signed-in users are sent on to their home. */
const AUTH_PAGES = ["/login", "/signup", "/forgot-password"];

/** Reachable without signing in. Everything else requires a session. */
const PUBLIC_PREFIXES = [
  ...AUTH_PAGES,
  "/auth", // callback + continue
  "/reset-password", // checks its own recovery session
  "/m", // public customer menu
  "/dev", // dev-only component gallery (404 in production)
];

function matches(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Optimistic route protection: refreshes the session and bounces signed-out
 * users to /login. This is NOT the security boundary — every page, server
 * action and route handler re-checks with requireUser()/requirePermission(),
 * and RLS protects the data.
 */
export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (!userId && pathname !== "/" && !matches(pathname, PUBLIC_PREFIXES)) {
    return redirectWithCookies(request, response, "/login", {
      next: pathname + search,
    });
  }

  if (userId && matches(pathname, AUTH_PAGES)) {
    return redirectWithCookies(request, response, "/auth/continue");
  }

  return response;
}

export const config = {
  matcher: [
    // Skip static files, images, and public webhook endpoints.
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
