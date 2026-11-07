import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { publicEnv } from "@/lib/env";

/**
 * Supabase client with the SECRET key. Bypasses RLS.
 * Server-only: webhooks, background jobs, trusted server actions.
 * Always scope queries by restaurant_id yourself when using this.
 */
export function createAdminClient() {
  const secretKey = z
    .string()
    .min(1, "SUPABASE_SECRET_KEY is missing")
    .parse(process.env.SUPABASE_SECRET_KEY);

  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
