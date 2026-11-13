/**
 * Privacy for logs and error reports (Phase 12). No customer phone numbers,
 * addresses, emails or tokens in full — anywhere we print or send errors.
 * Pure, no imports: used by the server, the browser and Sentry hooks.
 */

/** +923001234567 / 923001234567 / 03001234567 → 0300-***4567 style. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  if (d.length < 7) return "***";
  return `${d.slice(0, Math.min(4, d.length - 4))}***${d.slice(-4)}`;
}

const PATTERNS: [RegExp, (m: string) => string][] = [
  // Bearer / access tokens (Meta tokens start with EAA), JWTs, API keys.
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/g, () => "Bearer [redacted]"],
  [/\bEAA[A-Za-z0-9]{20,}/g, () => "[token]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, () => "[jwt]"],
  [/\b(sk|sb_secret|gsk|AIza)[-_A-Za-z0-9]{16,}/g, () => "[key]"],
  // Emails.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, () => "[email]"],
  // Phone numbers: +92 / 92 / 03xx… (8–15 digits, optional separators).
  [/(?<![\w-])\+?\d[\d\s-]{7,16}\d(?![\w-])/g, (m) => maskPhone(m)],
];

/** Mask phones, emails and secrets inside any text. */
export function scrubText(text: string): string {
  let out = text;
  for (const [re, fn] of PATTERNS) out = out.replace(re, fn);
  return out;
}

const SENSITIVE_KEYS = /phone|wa_id|waid|address|landmark|email|token|secret|password|authorization|cookie|latitude|longitude|customer_name|name$/i;

/** Deep copy with sensitive fields removed and strings scrubbed (for Sentry extras). */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}
