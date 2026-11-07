import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/**
 * Normalise a phone number to E.164 (+923001234567). Pakistani formats people
 * actually type all work: 0300-1234567, 03001234567, 0300 1234567,
 * +92 300 1234567, 923001234567, 00923001234567. Returns null if invalid.
 */
export function normalizePhone(input: string | null | undefined, defaultCountry: "PK" = "PK"): string | null {
  if (!input) return null;
  let raw = input.trim().replace(/[\s().-]/g, "");
  if (!raw) return null;
  if (raw.startsWith("00")) raw = `+${raw.slice(2)}`;
  // "923001234567" — a country code typed without the plus.
  if (/^92\d{10}$/.test(raw)) raw = `+${raw}`;
  const parsed = parsePhoneNumberFromString(raw, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** +923001234567 → 0300-1234567 (Pakistani numbers), otherwise international format. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+92(3\d{2})(\d{7})$/.exec(e164);
  if (m) return `0${m[1]}-${m[2]}`;
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}
