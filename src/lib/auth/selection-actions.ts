"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import {
  ALL_BRANCHES,
  BRANCH_COOKIE,
  RESTAURANT_COOKIE,
  SELECTION_COOKIE_OPTIONS,
} from "./cookies";
import { getMemberships, requireMembership, requireUser } from "./session";

/** Choose which restaurant to work in (users with more than one). */
export async function selectRestaurant(restaurantId: string) {
  await requireUser();
  const id = z.uuid().safeParse(restaurantId);
  const memberships = await getMemberships();
  // Never trust the id from the browser: it must be one of the user's memberships.
  const membership = id.success
    ? memberships.find((m) => m.restaurant_id === id.data)
    : undefined;
  if (!membership) redirect("/select-restaurant");

  const cookieStore = await cookies();
  cookieStore.set(RESTAURANT_COOKIE, membership.restaurant_id, SELECTION_COOKIE_OPTIONS);
  cookieStore.delete(BRANCH_COOKIE);
  redirect("/auth/continue");
}

/** Switch branch, or "all" for restaurant-wide members. */
export async function selectBranch(branchId: string): Promise<ActionResult> {
  const ctx = await requireMembership();
  if (!ctx.isRestaurantWide) {
    return { ok: false, error: "You can only see your own branch." };
  }
  const valid =
    branchId === ALL_BRANCHES || ctx.branches.some((b) => b.id === branchId);
  if (!valid) return { ok: false, error: "That branch isn't available." };

  const cookieStore = await cookies();
  cookieStore.set(BRANCH_COOKIE, branchId, SELECTION_COOKIE_OPTIONS);
  return { ok: true };
}
