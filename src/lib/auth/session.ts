import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";
import { ALL_BRANCHES, BRANCH_COOKIE, RESTAURANT_COOKIE } from "./cookies";
import { can, homePathForRole, SUSPENDED_ALLOWED, type Action, type Role } from "./permissions";

/**
 * Data access layer for "who is this and what can they do".
 * Every helper is wrapped in React cache() so a request hits the DB once,
 * no matter how many components ask.
 *
 * With cacheComponents on, anything calling these reads cookies, so it must
 * render inside <Suspense>.
 */

export type CurrentUser = {
  id: string;
  email: string | null;
  profile: Tables<"profiles">;
};

export type RestaurantSummary = Pick<
  Tables<"restaurants">,
  "id" | "name" | "slug" | "logo_url" | "status" | "city" | "phone" | "whatsapp_number" | "timezone"
>;

export type BranchSummary = Pick<
  Tables<"branches">,
  "id" | "name" | "area" | "is_open" | "is_active"
>;

export type MembershipWithRestaurant = Pick<
  Tables<"memberships">,
  "id" | "restaurant_id" | "branch_id" | "role" | "is_active"
> & { restaurant: RestaurantSummary };

export type CurrentContext = {
  user: CurrentUser;
  membership: MembershipWithRestaurant;
  role: Role;
  restaurant: RestaurantSummary;
  /** Branches this user may see (one, for branch-limited members). */
  branches: BranchSummary[];
  /** Selected branch, or null for "All branches". */
  currentBranch: BranchSummary | null;
  /** True if the membership covers every branch. */
  isRestaurantWide: boolean;
};

export class PermissionError extends Error {
  constructor(public action: Action) {
    super(`You don't have permission to do this (${action}).`);
    this.name = "PermissionError";
  }
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Session checks compare token expiry with the clock: always request-time,
  // never part of a prerender (Next would flag Supabase's Date.now()).
  await connection();
  const supabase = await createClient();
  // getClaims() verifies the JWT; never trust getSession() on the server.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (!profile) return null;

  return {
    id: userId,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
    profile,
  };
});

export const getMemberships = cache(async (): Promise<MembershipWithRestaurant[]> => {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select(
      "id, restaurant_id, branch_id, role, is_active, restaurant:restaurants(id, name, slug, logo_url, status, city, phone, whatsapp_number, timezone)",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at");
  return (data ?? []).filter(
    (m): m is MembershipWithRestaurant => m.restaurant !== null,
  );
});

/**
 * The membership for the restaurant in the cookie, re-verified against the
 * DB. Falls back to the only membership if the user has exactly one.
 * Returns null if the user has none, or must pick between several.
 */
export const getCurrentMembership = cache(async (): Promise<CurrentContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const memberships = await getMemberships();
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const wanted = cookieStore.get(RESTAURANT_COOKIE)?.value;
  const membership =
    memberships.find((m) => m.restaurant_id === wanted) ??
    (memberships.length === 1 ? memberships[0] : undefined);
  if (!membership) return null;

  const supabase = await createClient();
  const isRestaurantWide = membership.branch_id === null;
  let query = supabase
    .from("branches")
    .select("id, name, area, is_open, is_active")
    .eq("restaurant_id", membership.restaurant_id)
    .eq("is_active", true)
    .order("created_at");
  if (!isRestaurantWide) query = query.eq("id", membership.branch_id!);
  const { data: branches } = await query;
  const list = branches ?? [];

  let currentBranch: BranchSummary | null = null;
  if (!isRestaurantWide) {
    currentBranch = list[0] ?? null;
  } else {
    const wantedBranch = cookieStore.get(BRANCH_COOKIE)?.value;
    if (wantedBranch && wantedBranch !== ALL_BRANCHES) {
      currentBranch = list.find((b) => b.id === wantedBranch) ?? null;
    }
    // With a single branch there's nothing to choose: select it.
    if (!currentBranch && list.length === 1) currentBranch = list[0];
  }

  return {
    user,
    membership,
    role: membership.role,
    restaurant: membership.restaurant,
    branches: list,
    currentBranch,
    isRestaurantWide,
  };
});

/** Where a signed-in user should go right now. */
export async function getHomePath(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) return "/login";
  if (user.profile.must_change_password) return "/change-password";
  if (user.profile.is_super_admin) return "/admin";
  const memberships = await getMemberships();
  if (memberships.length === 0) return "/onboarding";
  const current = await getCurrentMembership();
  if (!current) return "/select-restaurant";
  return homePathForRole(current.role);
}

/** Signed-in user or redirect to /login. Forces /change-password when flagged. */
export async function requireUser(options?: { allowPasswordChange?: boolean }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.profile.must_change_password && !options?.allowPasswordChange) {
    redirect("/change-password");
  }
  return user;
}

/** Signed-in user with a selected, verified restaurant membership. */
export async function requireMembership(): Promise<CurrentContext> {
  await requireUser();
  const current = await getCurrentMembership();
  if (!current) {
    const memberships = await getMemberships();
    redirect(memberships.length === 0 ? "/onboarding" : "/select-restaurant");
  }
  return current;
}

/**
 * Checks the permissions matrix for the current membership.
 * - No session / membership → redirects (login, onboarding, picker).
 * - Not allowed → throws PermissionError (server actions), or with
 *   { onDenied: "redirect" } sends the user to their home page (pages).
 */
export async function requirePermission(
  action: Action,
  options?: { onDenied?: "throw" | "redirect" },
): Promise<CurrentContext> {
  const ctx = await requireMembership();
  // Suspended (unpaid) restaurant: only the billing page works. Server-side,
  // so server actions and route handlers are blocked too. Nothing is deleted.
  if (ctx.restaurant.status === "suspended" && !SUSPENDED_ALLOWED.includes(action) && !ctx.user.profile.is_super_admin) {
    if (options?.onDenied === "redirect") redirect("/suspended");
    throw new PermissionError(action);
  }
  if (!can(ctx.role, action)) {
    if (options?.onDenied === "redirect") redirect(homePathForRole(ctx.role));
    throw new PermissionError(action);
  }
  return ctx;
}

/** Super admin only (platform owner). */
export async function requireSuperAdmin() {
  const user = await requireUser();
  if (!user.profile.is_super_admin) redirect(await getHomePath());
  return user;
}
