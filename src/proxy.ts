import type { NextRequest } from "next/server";
import { redirectWithCookies, updateSession } from "@/lib/supabase/proxy";

/** Pages for signed-out visitors. Signed-in users are sent on to their home. */
const AUTH_PAGES = ["/login", "/signup", "/forgot-password", "/rider/login"];

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

  // Riders log in with phone + PIN, not email.
  if (!userId && matches(pathname, ["/rider"]) && pathname !== "/rider/login") {
    return redirectWithCookies(request, response, "/rider/login", {});
  }
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
    // Skip static files, images, public webhook endpoints, and the public
    // customer menu + its API (no session needed: saves a round trip on slow phones).
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/public/|m/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
