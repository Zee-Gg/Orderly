/** httpOnly cookies holding the user's chosen restaurant/branch.
 *  Values are only hints: the server re-checks them against memberships. */
export const RESTAURANT_COOKIE = "orderly_restaurant";
export const BRANCH_COOKIE = "orderly_branch";
/** Branch cookie value meaning "All branches". */
export const ALL_BRANCHES = "all";

export const SELECTION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const;
