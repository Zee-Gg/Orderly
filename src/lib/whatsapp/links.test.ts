import { describe, expect, it } from "vitest";
import { qrPng, qrSvg, waMeLink } from "./links";

describe("waMeLink", () => {
  it("opens a chat with the number and the pre-filled order message", () => {
    expect(waMeLink("+92 300 1234567")).toBe("https://wa.me/923001234567?text=Hi%2C%20I%20want%20to%20order");
    expect(waMeLink("+1 (555) 155-6437")).toBe("https://wa.me/15551556437?text=Hi%2C%20I%20want%20to%20order");
  });

  it("returns null for numbers that can't be real", () => {
    expect(waMeLink("")).toBeNull();
    expect(waMeLink("12345")).toBeNull();
  });
});

describe("QR code", () => {
  it("makes an SVG and a PNG", async () => {
    const link = waMeLink("+92 300 1234567")!;
    expect(await qrSvg(link)).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    const png = await qrPng(link);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});
