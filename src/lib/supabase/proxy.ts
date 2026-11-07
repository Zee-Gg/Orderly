import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Refreshes the Supabase auth session on every matched request and writes
 * the refreshed cookies to both the request (for Server Components) and the
 * response (for the browser). Returns the signed-in user's id, if any.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          // Prevents CDNs from caching responses that carry auth cookies.
          Object.entries(headers ?? {}).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Do not put code between createServerClient and getClaims():
  // getClaims() is what triggers the token refresh.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub ?? null;

  return { response, userId };
}

/** Redirect while keeping any refreshed auth cookies. */
export function redirectWithCookies(
  request: NextRequest,
  from: NextResponse,
  pathname: string,
  search?: Record<string, string>,
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  for (const [k, v] of Object.entries(search ?? {})) url.searchParams.set(k, v);
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}
