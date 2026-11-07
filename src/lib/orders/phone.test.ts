import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    "0300-1234567",
    "03001234567",
    "0300 1234567",
    "+923001234567",
    "+92 300 1234567",
    "923001234567",
    "00923001234567",
    "(0300) 123-4567",
  ])("%s → +923001234567", (input) => {
    expect(normalizePhone(input)).toBe("+923001234567");
  });

  it("accepts Pakistani landlines", () => {
    expect(normalizePhone("042-35761234")).toBe("+924235761234");
  });

  it("keeps foreign numbers in E.164", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it.each(["", "   ", "abc", "0300-123", "12345", null, undefined])("rejects %s", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("formatPhone", () => {
  it("shows Pakistani mobiles the local way", () => {
    expect(formatPhone("+923001234567")).toBe("0300-1234567");
  });
});
