import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";

process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/** Service-role client for test setup/cleanup only. */
export const admin: SupabaseClient<Database> = createClient<Database>(url, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type TestUser = {
  id: string;
  client: SupabaseClient<Database>;
  /** Auth cookies exactly as the app sets them, for browser contexts. */
  cookies: { name: string; value: string; domain: string; path: string }[];
};

/** Create a confirmed user and sign in through @supabase/ssr to get real cookies. */
export async function createTestUser(label: string, run: string): Promise<TestUser> {
  const email = `e2e-${label}-${run}@example.com`;
  const password = `E2e-${run}-Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `E2E ${label}` },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");

  const jar = new Map<string, string>();
  const client = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach((c) => jar.set(c.name, c.value)),
    },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return {
    id: data.user.id,
    client: client as unknown as SupabaseClient<Database>,
    cookies: [...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })),
  };
}

export async function cleanup(restaurantIds: string[], userIds: string[]) {
  if (restaurantIds.length) await admin.from("restaurants").delete().in("id", restaurantIds);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
}
