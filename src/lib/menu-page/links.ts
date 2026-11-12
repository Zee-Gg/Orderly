/**
 * Links to the customer menu page (Phase 8). The bot runs in webhooks (no
 * request), so the base URL comes from NEXT_PUBLIC_SITE_URL. Pure.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** https://app.example.com/m/<slug>[?branch=<id>] */
export function menuPageUrl(slug: string, branchId?: string | null, base: string = siteUrl()): string {
  return `${base}/m/${encodeURIComponent(slug)}${branchId ? `?branch=${branchId}` : ""}`;
}
