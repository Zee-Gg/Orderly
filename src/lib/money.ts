const rupeeFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const rupeeWithPaisaFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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
