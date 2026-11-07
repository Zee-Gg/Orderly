const rupeeFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const rupeeWithPaisaFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Parse what someone typed in a Rs field ("1,850", "1850", " 99.5 ") into
 * integer paisa. Returns null for empty or invalid input.
 */
export function parseRupees(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, "").replace(/^rs\.?/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const paisa = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(paisa) ? paisa : null;
}

/** Integer paisa → editable rupees text: 185000 → "1850", 185050 → "1850.5". */
export function paisaToInput(paisa: number | null | undefined): string {
  if (paisa === null || paisa === undefined) return "";
  return String(paisa / 100);
}

/**
 * Format an integer amount in paisa for display.
 *   formatPKR(185000) → "Rs 1,850"
 *   formatPKR(185050) → "Rs 1,850.50"
 *   formatPKR(-5000)  → "-Rs 50"
 *
 * Money is always stored as integer paisa. A non-integer here is a bug
 * upstream, so we throw instead of silently rounding.
 */
export function formatPKR(paisa: number): string {
  if (!Number.isSafeInteger(paisa)) {
    throw new TypeError(`formatPKR expects integer paisa, got ${paisa}`);
  }
  const sign = paisa < 0 ? "-" : "";
  const abs = Math.abs(paisa);
  const formatter = abs % 100 === 0 ? rupeeFormatter : rupeeWithPaisaFormatter;
  return `${sign}Rs ${formatter.format(abs / 100)}`;
}
