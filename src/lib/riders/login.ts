"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { normalizePhone } from "@/lib/orders/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimitByIp, TOO_MANY } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES, lockedFor, pinSchema, riderEmail } from "./core";

/**
 * Rider login: phone + 6-digit PIN (riders often have no email). The auth
 * account uses a hidden email made from the phone. 5 wrong PINs lock the
 * phone for 15 minutes. Sessions are long-lived (the normal refresh cookie).
 */
const schema = z.object({ phone: z.string().trim().min(5).max(20), pin: pinSchema });

export async function riderLoginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse({ phone: formData.get("phone"), pin: formData.get("pin") });
  if (!parsed.success) return { ok: false, error: "Enter your phone number and 6-digit PIN." };
  if (!(await rateLimitByIp("riderLogin"))) return { ok: false, error: TOO_MANY };
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return { ok: false, error: "Phone number is not correct.", fieldErrors: { phone: "Like 0300 1234567" } };

  const admin = createAdminClient();
  const { data: attempt } = await admin.from("rider_login_attempts").select("locked_until").eq("phone", phone).maybeSingle();
  const wait = lockedFor(attempt?.locked_until);
  if (wait) return { ok: false, error: `Too many wrong PINs. Try again in ${wait} minutes.` };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: riderEmail(phone), password: parsed.data.pin });
  if (error || !data.user) {
    const { data: after } = await admin.rpc("rider_login_failed", { p_phone: phone, p_max: LOGIN_MAX_FAILURES, p_lock_minutes: LOGIN_LOCK_MINUTES });
    const state = after as { failed_count: number; locked_until: string | null } | null;
    const lockedNow = lockedFor(state?.locked_until);
    if (lockedNow) return { ok: false, error: `Too many wrong PINs. Try again in ${LOGIN_LOCK_MINUTES} minutes.` };
    const left = Math.max(0, LOGIN_MAX_FAILURES - (state?.failed_count ?? 0));
    return { ok: false, error: `Wrong phone or PIN. ${left} ${left === 1 ? "try" : "tries"} left.` };
  }

  // A deactivated rider can't work, even with the right PIN.
  const { data: rider } = await admin.from("rider_profiles").select("is_active").eq("user_id", data.user.id).maybeSingle();
  if (!rider?.is_active) {
    await supabase.auth.signOut();
    return { ok: false, error: "Your rider account is switched off. Please talk to the manager." };
  }
  await admin.from("rider_login_attempts").delete().eq("phone", phone);
  redirect("/rider");
}

export async function riderLogoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/rider/login");
}
