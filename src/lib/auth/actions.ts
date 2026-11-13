"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { failure, zodFailure, type ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimitByIp, TOO_MANY } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  loginSchema,
  safeNextPath,
  setPasswordSchema,
  signupSchema,
} from "@/lib/validation/auth";
import { BRANCH_COOKIE, RESTAURANT_COOKIE } from "./cookies";
import { requireUser } from "./session";

async function siteOrigin() {
  const h = await headers();
  return (
    h.get("origin") ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    `https://${h.get("host")}`
  );
}

function continuePath(next: string | null) {
  return next ? `/auth/continue?next=${encodeURIComponent(next)}` : "/auth/continue";
}

/** Supabase auth messages → plain, friendly English. */
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email or password is wrong. Please try again.";
  if (m.includes("email not confirmed")) return "Please confirm your email first. Check your inbox for our link.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "An account with this email already exists. Try logging in instead.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many tries. Please wait a few minutes and try again.";
  if (m.includes("should be different")) return "Your new password must be different from the old one.";
  if (m.includes("weak") || m.includes("password should"))
    return "Please choose a stronger password (at least 8 characters, mix letters and numbers).";
  return "Something went wrong. Please try again.";
}

export async function signIn(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return zodFailure(parsed.error);
  if (!(await rateLimitByIp("login"))) return { ok: false, error: TOO_MANY };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, error: friendlyAuthError(error.message) };

  redirect(continuePath(safeNextPath(formData.get("next"))));
}

export async function signUp(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return zodFailure(parsed.error);
  if (!(await rateLimitByIp("signup"))) return { ok: false, error: TOO_MANY };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${await siteOrigin()}/auth/callback`,
    },
  });
  if (error) return { ok: false, error: friendlyAuthError(error.message) };

  // Email confirmation turned off in Supabase → already signed in.
  if (data.session) redirect("/auth/continue");
  return { ok: true, message: parsed.data.email };
}

export async function requestPasswordReset(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return zodFailure(parsed.error);
  if (!(await rateLimitByIp("passwordReset"))) return { ok: false, error: TOO_MANY };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await siteOrigin()}/auth/callback?next=/reset-password`,
  });
  if (error && error.message.toLowerCase().includes("rate limit")) {
    return { ok: false, error: friendlyAuthError(error.message) };
  }
  // Same answer whether or not the account exists (don't reveal accounts).
  return { ok: true, message: parsed.data.email };
}

/** Used by /reset-password and the forced /change-password. */
export async function setNewPassword(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = setPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return zodFailure(parsed.error);

  try {
    const user = await requireUser({ allowPasswordChange: true });
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) return { ok: false, error: friendlyAuthError(error.message) };

    if (user.profile.must_change_password) {
      // Users can't write this column themselves (no column grant), so the
      // server clears it right after a successful password change.
      const admin = createAdminClient();
      const { error: flagError } = await admin
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", user.id);
      if (flagError) throw flagError;
    }
  } catch (err) {
    return failure(err);
  }
  redirect("/auth/continue");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(RESTAURANT_COOKIE);
  cookieStore.delete(BRANCH_COOKIE);
  redirect("/login");
}
