import { revalidateTag } from "next/cache";

/**
 * Cache tag of a restaurant's public menu page (/m/[slug]): menu, stock,
 * prices, offers, branches, logo, WhatsApp number. Clear it after any of
 * those change — the next customer gets fresh data (no stale window).
 */
export const publicMenuTag = (restaurantId: string) => `public-menu:${restaurantId}`;

export function revalidatePublicMenu(restaurantId: string) {
  revalidateTag(publicMenuTag(restaurantId), { expire: 0 });
}
