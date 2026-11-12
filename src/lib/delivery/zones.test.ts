import { describe, expect, it } from "vitest";
import { areaTokens, distanceKm, findZone, matchDeliveryZone, nameScore, UNLISTED_AREA_FLAG, type DeliveryZone, type ZonePolicy } from "./zones";

const zone = (id: string, name: string, aliases: string[], fee: number, min = 0, eta: number | null = 40): DeliveryZone => ({
  id,
  name,
  aliases,
  deliveryFee: fee,
  minimumOrder: min,
  estimatedMinutes: eta,
  isActive: true,
});

const ZONES = [
  zone("dha5", "DHA Phase 5", ["dha 5", "phase 5", "defence phase 5"], 15000, 80000, 35),
  zone("dha6", "DHA Phase 6", ["dha 6", "phase 6"], 20000, 100000, 45),
  zone("clifton", "Clifton", ["clifton block 5", "kehkashan"], 10000),
  zone("gulshan", "Gulshan-e-Iqbal", ["gulshan", "gulshan e iqbal"], 25000, 150000, 60),
];
const BRANCH = { latitude: 24.8138, longitude: 67.0299 };
const POLICY: ZonePolicy = { defaultFee: 15000, defaultMinimum: 50000, unlistedPolicy: "default_fee", maxRadiusKm: null, branchLocation: BRANCH };

describe("area words", () => {
  it("splits and normalizes common spellings", () => {
    expect(areaTokens("DHA Ph-5")).toEqual(["dha", "phase", "5"]);
    expect(areaTokens("dha phase five")).toEqual(["dha", "phase", "5"]);
    expect(areaTokens("Phase5")).toEqual(["phase", "5"]);
    expect(areaTokens("Gulshan-e-Iqbal Block 13")).toEqual(["gulshan", "e", "iqbal", "block", "13"]);
  });
});

describe("zone matching by name and other names", () => {
  const top = (text: string) => findZone(ZONES, text)?.zone.id ?? null;

  it("names, other names, Roman Urdu and misspellings", () => {
    expect(top("DHA Phase 5")).toBe("dha5");
    expect(top("house 12, street 4, dha phase 5")).toBe("dha5");
    expect(top("D.H.A ph 5")).toBe("dha5");
    expect(top("dha fase paanch")).toBe("dha5");
    expect(top("defence phase 5 near imtiaz")).toBe("dha5");
    expect(top("Cliftan block 5")).toBe("clifton");
    expect(top("kehkashan clifton")).toBe("clifton");
    expect(top("gulshan e iqbal block 13")).toBe("gulshan");
    expect(top("gulshn")).toBe("gulshan");
  });

  it("numbers must match exactly: Phase 5 is not Phase 6", () => {
    expect(top("DHA phase 6")).toBe("dha6");
    expect(top("dha phase 7")).toBeNull();
    expect(nameScore("DHA Phase 5", "DHA Phase 8")).toBe(0);
  });

  it("unknown areas and inactive zones don't match", () => {
    expect(top("Saddar")).toBeNull();
    expect(top("North Nazimabad")).toBeNull();
    expect(findZone([{ ...ZONES[2], isActive: false }], "clifton")).toBeNull();
  });
});

describe("matchDeliveryZone: fee, minimum, radius, unlisted policy", () => {
  it("matched zone → its fee, minimum and time", () => {
    expect(matchDeliveryZone(ZONES, { area: "DHA 5", address: "House 1" }, POLICY)).toMatchObject({
      kind: "zone",
      fee: 15000,
      minimumOrder: 80000,
      etaMinutes: 35,
    });
  });

  it("the area field wins over words in the address", () => {
    expect(matchDeliveryZone(ZONES, { area: "Clifton", address: "near DHA Phase 6 signal" }, POLICY)).toMatchObject({ kind: "zone", zone: { id: "clifton" } });
  });

  it("unlisted area: default fee + flag, or 'not served' when the branch rejects", () => {
    expect(matchDeliveryZone(ZONES, { area: "Saddar" }, POLICY)).toEqual({ kind: "unlisted", fee: 15000, minimumOrder: 50000, flag: UNLISTED_AREA_FLAG, distanceKm: null });
    expect(matchDeliveryZone(ZONES, { area: "Saddar" }, { ...POLICY, unlistedPolicy: "reject" })).toMatchObject({ kind: "out_of_range", reason: "area_not_served" });
  });

  it("no zones set up → deliver at the branch fee, no flag", () => {
    expect(matchDeliveryZone([], { area: "anywhere" }, { ...POLICY, unlistedPolicy: "reject" })).toMatchObject({ kind: "unlisted", fee: 15000, flag: null });
  });

  it("radius: a pin farther than the max is out of range (even inside a listed area name)", () => {
    const far = { latitude: 24.9375, longitude: 67.0753 }; // ~14 km
    const near = { latitude: 24.82, longitude: 67.04 }; // ~1 km
    expect(distanceKm(BRANCH, far)).toBeGreaterThan(13);
    expect(distanceKm(BRANCH, near)).toBeLessThan(2);
    const withRadius = { ...POLICY, maxRadiusKm: 8 };
    expect(matchDeliveryZone(ZONES, { area: "Gulshan", location: far }, withRadius)).toMatchObject({ kind: "out_of_range", reason: "radius" });
    expect(matchDeliveryZone(ZONES, { area: "DHA 5", location: near }, withRadius)).toMatchObject({ kind: "zone", distanceKm: expect.any(Number) });
    // No radius set, or no branch location → radius isn't checked.
    expect(matchDeliveryZone(ZONES, { area: "Gulshan", location: far }, POLICY)).toMatchObject({ kind: "zone" });
    expect(matchDeliveryZone(ZONES, { area: "Gulshan", location: far }, { ...withRadius, branchLocation: null })).toMatchObject({ kind: "zone" });
  });
});
