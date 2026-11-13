import { NextResponse, type NextRequest } from "next/server";
import { redirectWithCookies, updateSession } from "@/lib/supabase/proxy";

/** Pages for signed-out visitors. Signed-in users are sent on to their home. */
const AUTH_PAGES = ["/login", "/signup", "/forgot-password", "/rider/login"];

/** Reachable without signing in. Everything else requires a session. */
const PUBLIC_PREFIXES = [
  ...AUTH_PAGES,
  "/auth", // callback + continue
  "/reset-password", // checks its own recovery session
  "/m", // public customer menu
  "/dev", // dev-only tools (blocked below in production)
  "/privacy",
  "/terms",
  "/contact",
  "/api/health", // uptime monitor
  "/api/cron", // Vercel Cron (checks CRON_SECRET itself)
  "/manifest.webmanifest",
];

/** Dev tools (playground, voice tests, component gallery) never exist in production. */
const DEV_PREFIXES = ["/dev", "/api/dev"];
function devToolsOn() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_TOOLS === "1";
}

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
  const { pathname: path } = request.nextUrl;
  if (!devToolsOn() && matches(path, DEV_PREFIXES)) {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const { response, userId } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  // "/" is the public landing page; signed-in users go to their dashboard.
  if (userId && pathname === "/") {
    return redirectWithCookies(request, response, "/auth/continue");
  }

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
