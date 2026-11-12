import { describe, expect, it } from "vitest";
import { DEMO_FAQS } from "@/lib/menu/demo-menu";
import {
  coordinatesFromMapsUrl,
  isShortMapsLink,
  matchFaqs,
  menuImageOutdated,
  offerScheduleText,
  offerState,
  type FaqRecord,
  type OfferRecord,
} from "./knowledge";

const TZ = "Asia/Karachi"; // UTC+5, no DST
/** Karachi local time → Date. 2026-11-13 is a Friday, 2026-11-15 a Sunday, 2026-11-16 a Monday. */
const pk = (local: string) => new Date(`${local}+05:00`);

const offer = (o: Partial<OfferRecord> = {}): OfferRecord => ({
  id: "o1",
  branchId: null,
  title: "Deal",
  titleUr: null,
  description: null,
  menuItemId: "i1",
  imagePath: null,
  startsAt: "2026-01-01T00:00:00Z",
  endsAt: null,
  daysOfWeek: null,
  startTime: null,
  endTime: null,
  isActive: true,
  sortOrder: 0,
  ...o,
});

describe("offer schedule", () => {
  it("every day, all day → active; switched off → off", () => {
    expect(offerState(offer(), pk("2026-11-11T10:00:00"), TZ)).toBe("active");
    expect(offerState(offer({ isActive: false }), pk("2026-11-11T10:00:00"), TZ)).toBe("off");
  });

  it("start and end dates: scheduled before, expired after", () => {
    const o = offer({ startsAt: pk("2026-11-20T00:00:00").toISOString(), endsAt: pk("2026-11-30T00:00:00").toISOString() });
    expect(offerState(o, pk("2026-11-19T23:59:00"), TZ)).toBe("scheduled");
    expect(offerState(o, pk("2026-11-20T00:00:00"), TZ)).toBe("active");
    expect(offerState(o, pk("2026-11-30T00:00:00"), TZ)).toBe("expired");
  });

  it("Friday only, in the restaurant's time zone (not UTC)", () => {
    const friday = offer({ daysOfWeek: [5] });
    expect(offerState(friday, pk("2026-11-13T12:00:00"), TZ)).toBe("active");
    expect(offerState(friday, pk("2026-11-14T12:00:00"), TZ)).toBe("scheduled");
    // Friday 00:30 in Karachi is still Thursday in UTC.
    expect(offerState(friday, pk("2026-11-13T00:30:00"), TZ)).toBe("active");
    expect(offerState(friday, pk("2026-11-12T23:30:00"), TZ)).toBe("scheduled");
  });

  it("weekdays 12:00–16:00 (Student Deal)", () => {
    const student = offer({ daysOfWeek: [1, 2, 3, 4, 5], startTime: "12:00:00", endTime: "16:00:00" });
    expect(offerState(student, pk("2026-11-16T12:00:00"), TZ)).toBe("active");
    expect(offerState(student, pk("2026-11-16T15:59:00"), TZ)).toBe("active");
    expect(offerState(student, pk("2026-11-16T16:00:00"), TZ)).toBe("scheduled");
    expect(offerState(student, pk("2026-11-16T11:59:00"), TZ)).toBe("scheduled");
    expect(offerState(student, pk("2026-11-15T13:00:00"), TZ)).toBe("scheduled"); // Sunday
  });

  it("a late-night window crosses midnight and belongs to the day it started", () => {
    const night = offer({ daysOfWeek: [5], startTime: "22:00", endTime: "02:00" });
    expect(offerState(night, pk("2026-11-13T23:00:00"), TZ)).toBe("active"); // Fri 23:00
    expect(offerState(night, pk("2026-11-14T01:30:00"), TZ)).toBe("active"); // Sat 01:30 = Friday night
    expect(offerState(night, pk("2026-11-14T02:00:00"), TZ)).toBe("scheduled");
    expect(offerState(night, pk("2026-11-13T01:00:00"), TZ)).toBe("scheduled"); // Fri 01:00 = Thursday night
  });

  it("schedule text for staff", () => {
    expect(offerScheduleText(offer())).toBe("Every day");
    expect(offerScheduleText(offer({ daysOfWeek: [5, 1], startTime: "12:00:00", endTime: "16:00:00" }))).toBe("Mon, Fri · 12:00–16:00");
  });
});

describe("FAQ matching", () => {
  const faqs: FaqRecord[] = DEMO_FAQS.map((f, i) => ({ id: `f${i}`, answerUr: null, isActive: true, sortOrder: i, ...f }));
  const top = (q: string) => matchFaqs(faqs, q)[0]?.faq.question ?? null;

  it("finds answers in Roman Urdu, English and with misspellings", () => {
    expect(top("parking hai?")).toBe("Parking available?");
    expect(top("gari kahan park karein")).toBe("Parking available?");
    expect(top("Do you have a family hall")).toBe("Family hall?");
    expect(top("famly hall hai")).toBe("Family hall?");
    expect(top("birthday party arrange kar sakte ho?")).toBe("Birthday / party arrangements?");
    expect(top("kya khana halal hai")).toBe("Is the food halal?");
    expect(top("DHA mein deliver karte ho?")).toBe("Which areas do you deliver to?");
  });

  it("no match → nothing (the bot asks staff)", () => {
    expect(matchFaqs(faqs, "kya aap ke paas wifi hai")).toEqual([]);
    expect(matchFaqs(faqs, "do you sell gift cards")).toEqual([]);
    expect(matchFaqs(faqs, "hai?")).toEqual([]);
  });

  it("ignores switched-off and unanswered questions", () => {
    const off = faqs.map((f) => (f.question === "Parking available?" ? { ...f, isActive: false } : f.question === "Family hall?" ? { ...f, answer: "" } : f));
    expect(matchFaqs(off, "parking hai?")).toEqual([]);
    expect(matchFaqs(off, "family hall hai?")).toEqual([]);
  });
});

describe("old menu image check", () => {
  it("prices changed after the upload → outdated", () => {
    expect(menuImageOutdated("2026-11-10T10:00:00Z", "2026-11-11T10:00:00Z")).toBe(true);
    expect(menuImageOutdated("2026-11-11T10:00:00Z", "2026-11-10T10:00:00Z")).toBe(false);
    expect(menuImageOutdated(null, "2026-11-11T10:00:00Z")).toBe(false); // no image
    expect(menuImageOutdated("2026-11-10T10:00:00Z", null)).toBe(false); // no price change
  });
});

describe("Google Maps links", () => {
  it("reads coordinates from the common link shapes", () => {
    expect(coordinatesFromMapsUrl("https://www.google.com/maps/place/Cafe/@24.8138,67.0299,17z/data=!3m1")).toEqual({ latitude: 24.8138, longitude: 67.0299 });
    expect(
      coordinatesFromMapsUrl("https://www.google.com/maps/place/Cafe/@24.81,67.02,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d24.8141234!4d67.0301234"),
    ).toEqual({ latitude: 24.814123, longitude: 67.030123 }); // the pin (!3d!4d) wins over the map centre
    expect(coordinatesFromMapsUrl("https://maps.google.com/?q=24.8607,67.0011")).toEqual({ latitude: 24.8607, longitude: 67.0011 });
    expect(coordinatesFromMapsUrl("https://www.google.com/maps/search/?api=1&query=31.5204%2C74.3587")).toEqual({ latitude: 31.5204, longitude: 74.3587 });
    expect(coordinatesFromMapsUrl("https://www.google.com/maps/dir/?api=1&destination=33.6844,73.0479")).toEqual({ latitude: 33.6844, longitude: 73.0479 });
  });

  it("no coordinates / invalid → null; short links need expanding", () => {
    expect(coordinatesFromMapsUrl("https://www.google.com/maps/place/Some+Cafe")).toBeNull();
    expect(coordinatesFromMapsUrl("https://maps.google.com/?q=0,0")).toBeNull();
    expect(coordinatesFromMapsUrl("https://maps.google.com/?q=124.1,67.0")).toBeNull();
    expect(isShortMapsLink("https://maps.app.goo.gl/AbCd123")).toBe(true);
    expect(isShortMapsLink("https://goo.gl/maps/AbCd123")).toBe(true);
    expect(isShortMapsLink("https://example.com/maps")).toBe(false);
  });
});
