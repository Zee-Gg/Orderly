import { describe, expect, it } from "vitest";
import { cashInHand, cashToCollect, deliveredSince, lockedFor, mapsLink, pinSchema, riderEmail, type CashOrder } from "./core";

const order = (o: Partial<CashOrder>): CashOrder => ({
  status: "delivered",
  total: 100000,
  paymentStatus: "unpaid",
  codCollectedAmount: null,
  codCollectedAt: null,
  settlementId: null,
  deliveredAt: null,
  ...o,
});

describe("rider login", () => {
  it("hidden email from the phone; PIN is 6 digits", () => {
    expect(riderEmail("+923001234567")).toBe("rider-923001234567@riders.internal");
    expect(pinSchema.safeParse("123456").success).toBe(true);
    for (const bad of ["12345", "1234567", "12a456", ""]) expect(pinSchema.safeParse(bad).success).toBe(false);
  });

  it("lock: minutes left, 0 when not locked or expired", () => {
    const now = new Date("2026-11-12T10:00:00Z");
    expect(lockedFor(null, now)).toBe(0);
    expect(lockedFor("2026-11-12T10:14:10Z", now)).toBe(15);
    expect(lockedFor("2026-11-12T10:00:30Z", now)).toBe(1);
    expect(lockedFor("2026-11-12T09:59:00Z", now)).toBe(0);
  });
});

describe("cash", () => {
  it("cash to collect: the total, or nothing when already paid", () => {
    expect(cashToCollect({ total: 235000, paymentStatus: "unpaid" })).toBe(235000);
    expect(cashToCollect({ total: 235000, paymentStatus: "paid" })).toBe(0);
  });

  it("cash in hand = collected and not yet settled", () => {
    const orders = [
      order({ codCollectedAmount: 235000, codCollectedAt: "2026-11-12T10:00:00Z" }),
      order({ codCollectedAmount: 120000, codCollectedAt: "2026-11-11T20:00:00Z" }), // yesterday, still with the rider
      order({ codCollectedAmount: 99000, codCollectedAt: "2026-11-12T11:00:00Z", settlementId: "s1" }), // handed in
      order({ status: "out_for_delivery" }), // not collected yet
      order({ codCollectedAmount: 0, codCollectedAt: "2026-11-12T12:00:00Z" }), // paid online, nothing collected
    ];
    expect(cashInHand(orders)).toBe(355000);
  });

  it("deliveries today count only from the start of the day", () => {
    const start = new Date("2026-11-11T19:00:00Z"); // midnight in Karachi
    expect(deliveredSince([order({ deliveredAt: "2026-11-11T20:00:00Z" }), order({ deliveredAt: "2026-11-11T18:59:00Z" }), order({})], start)).toBe(1);
  });
});

describe("Open in Maps", () => {
  it("uses the pin when there is one, else the address text", () => {
    expect(mapsLink({ latitude: 24.81, longitude: 67.02, addressText: "House 1", area: null, landmark: null })).toBe(
      "https://www.google.com/maps/search/?api=1&query=24.81,67.02",
    );
    expect(mapsLink({ latitude: null, longitude: null, addressText: "House 12, Street 4", area: "DHA Phase 5", landmark: "near Masjid" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=House%2012%2C%20Street%204%2C%20near%20Masjid%2C%20DHA%20Phase%205",
    );
    expect(mapsLink({ latitude: null, longitude: null, addressText: null, area: null, landmark: null })).toBeNull();
  });
});
