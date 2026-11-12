import "server-only";
import { headers } from "next/headers";
import { menuPageUrl } from "./links";

/** Base URL for links shown in the dashboard: NEXT_PUBLIC_SITE_URL, else this request's host. */
export async function requestSiteUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function menuPageUrlForRequest(slug: string): Promise<string> {
  return menuPageUrl(slug, null, await requestSiteUrl());
}
