/**
 * Tiny CSV writer for report downloads (pure). Excel-friendly: UTF-8 BOM
 * (Urdu names), CRLF lines, and cells that start with = + - @ are prefixed
 * with ' so a customer name can never run as a spreadsheet formula.
 */
export type CsvCell = string | number | null | undefined;

function cell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return "\uFEFF" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Paisa → plain rupees for spreadsheets: 185000 → 1850, 185050 → 1850.5 */
export function rupees(paisa: number): number {
  return Math.round(paisa) / 100;
}
