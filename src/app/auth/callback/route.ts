import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/validation/auth";

/**
 * Landing point for links from Supabase: email confirmation, password reset
 * and Google sign-in. Exchanges the code for a session, then continues.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const next = safeNextPath(params.get("next")) ?? "/auth/continue";

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, request.url));

  if (params.get("error")) return fail("oauth");

  const supabase = await createClient();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail("link");
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return fail("link");
  } else {
    return fail("link");
  }

  return NextResponse.redirect(new URL(next, request.url));
}
