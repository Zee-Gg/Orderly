import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { clientIp } from "@/lib/menu-page/request";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Database-backed rate limits (Phase 12). Fixed windows in `rate_limits`
 * (RPC rate_limit_hit, service role). Keys are HMAC hashes — never raw IPs
 * or phone numbers. Fails OPEN: if the database can't be reached we let the
 * request through (Supabase Auth has its own limits behind ours).
 */
export const LIMITS = {
  login: { windowSeconds: 600, max: 20 }, // per IP, 10 min
  signup: { windowSeconds: 3600, max: 5 }, // per IP, hour
  passwordReset: { windowSeconds: 3600, max: 5 }, // per IP, hour
  riderLogin: { windowSeconds: 900, max: 30 }, // per IP, 15 min (plus 5 wrong PINs per phone)
  menuView: { windowSeconds: 3600, max: 120 }, // per IP, hour
  webhookBadSignature: { windowSeconds: 600, max: 20 }, // per IP, 10 min
  health: { windowSeconds: 60, max: 30 }, // per IP, minute
} as const;

export type LimitName = keyof typeof LIMITS;

function hashKey(name: string, value: string) {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.SUPABASE_SECRET_KEY || "orderly";
  return `${name}:${createHmac("sha256", secret).update(`${name}:${value}`).digest("hex").slice(0, 32)}`;
}

/** true = allowed. `value` is usually the client IP. */
export async function rateLimit(name: LimitName, value: string | null): Promise<boolean> {
  if (!value) return true;
  const { windowSeconds, max } = LIMITS[name];
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_key: hashKey(name, value),
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (error) {
      console.error("[rate-limit] check failed (allowing)", name, error.message);
      return true;
    }
    return data !== false;
  } catch (err) {
    console.error("[rate-limit] check failed (allowing)", name, err instanceof Error ? err.message : err);
    return true;
  }
}

/** Same, using the IP of the current request (server actions / pages). */
export async function rateLimitByIp(name: LimitName): Promise<boolean> {
  return rateLimit(name, clientIp(await headers()));
}

export const TOO_MANY = "Too many tries. Please wait a few minutes and try again.";
