/**
 * Order codes for the customer menu page (Phase 8): short, easy to read and
 * type. No look-alikes (O/0, I/1), always at least one letter and one digit
 * (so ordinary words like "NAAN" or numbers like "2500" are never codes).
 * Pure: no DB, no Next.js.
 */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const CODE_RE = /^[A-HJ-NP-Z2-9]{4,5}$/;

export function isValidCode(code: string): boolean {
  return CODE_RE.test(code) && /[2-9]/.test(code) && /[A-HJ-NP-Z]/.test(code);
}

/** A random code of `length` (4 or 5). `random` returns [0, 1) — inject for tests. */
export function generateCode(length = 4, random: () => number = cryptoRandom): string {
  const pick = (chars: string) => chars[Math.floor(random() * chars.length) % chars.length];
  for (;;) {
    const chars = Array.from({ length }, () => pick(CODE_ALPHABET));
    // Guarantee a letter and a digit at random positions.
    const letterAt = Math.floor(random() * length) % length;
    let digitAt = Math.floor(random() * length) % length;
    if (digitAt === letterAt) digitAt = (digitAt + 1) % length;
    if (!chars.some((c) => LETTERS.includes(c))) chars[letterAt] = pick(LETTERS);
    if (!chars.some((c) => DIGITS.includes(c))) chars[digitAt] = pick(DIGITS);
    const code = chars.join("");
    if (isValidCode(code)) return code;
  }
}

function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

/**
 * Codes the customer may have sent, best first: whole words anywhere in the
 * message (any case), then — after the word "code" — a code typed with spaces
 * or dashes ("7k 3p", "7-K-3-P").
 */
export function findCodesInText(text: string): string[] {
  const found: string[] = [];
  const add = (c: string) => {
    const up = c.toUpperCase();
    if (isValidCode(up) && !found.includes(up)) found.push(up);
  };
  for (const word of text.split(/[^A-Za-z0-9]+/)) if (word.length >= 4 && word.length <= 5) add(word);
  const after = text.match(/code\s*[:#-]?\s*([A-Za-z0-9](?:[\s-]?[A-Za-z0-9]){3,4})(?![A-Za-z0-9])/i);
  if (after) add(after[1].replace(/[\s-]/g, ""));
  return found;
}

/** The message mentions an order code (so an unknown code deserves an answer). */
export function mentionsOrderCode(text: string): boolean {
  return /\b(order\s*)?code\b|کوڈ/i.test(text);
}
