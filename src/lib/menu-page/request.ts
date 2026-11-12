import "server-only";
import { createHmac } from "node:crypto";

/** Client IP from proxy headers (Vercel / ngrok / nginx), or null. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || null;
}

/** HMAC of the IP (we never store raw IPs). */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const key = process.env.TOKEN_ENCRYPTION_KEY || process.env.SUPABASE_SECRET_KEY || "orderly";
  return createHmac("sha256", key).update(`menu-page:${ip}`).digest("hex").slice(0, 40);
}

/** Read a small JSON body (rejects anything over `maxBytes`). */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new Error("too large");
  const text = await req.text();
  if (text.length > maxBytes) throw new Error("too large");
  return JSON.parse(text);
}
