import { createHmac, timingSafeEqual } from "node:crypto";

/** "sha256=<hex>" for a raw request body. Used by the fake webhook script too. */
export function signPayload(rawBody: string | Buffer, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

/**
 * Checks Meta's X-Hub-Signature-256 header against the RAW body
 * (must be the exact bytes received — never re-serialised JSON).
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  header: string | null | undefined,
  appSecret: string | undefined,
): boolean {
  if (!header || !appSecret) return false;
  const expected = Buffer.from(signPayload(rawBody, appSecret));
  const given = Buffer.from(header.trim());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Constant-time string compare (for the GET verify token). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
