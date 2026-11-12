import { describe, expect, it } from "vitest";
import { priceMenuItem } from "@/lib/menu/pricing";
import { BRANCH_ID, createMemoryBotStore, RESTAURANT_ID } from "@/lib/bot/testing/memory-store";
import { CODE_ALPHABET, findCodesInText, generateCode, isValidCode, mentionsOrderCode } from "./code";
import { pick, texts, waLink, whatsappMessage } from "./i18n";
import { menuPageUrl, siteUrl } from "./links";

/** Deterministic random numbers for code generation. */
function seq(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("order codes", () => {
  it("are 4–5 readable characters with at least one letter and one digit", () => {
    for (let n = 0; n < 2000; n++) {
      const code = generateCode(n % 2 ? 5 : 4);
      expect(isValidCode(code)).toBe(true);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4,5}$/);
      expect(code).not.toMatch(/[O0I1]/);
    }
    expect(CODE_ALPHABET).not.toMatch(/[O0I1]/);
  });

  it("are spread out (few repeats in 2000 codes)", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateCode(4)));
    expect(codes.size).toBeGreaterThan(1990);
  });

  it("always get a digit and a letter, even when the random picks say otherwise", () => {
    expect(isValidCode(generateCode(4, seq([0])))).toBe(true); // all "A" → a digit is forced in
    expect(isValidCode(generateCode(4, seq([0.99])))).toBe(true); // all "9" → a letter is forced in
  });

  it("rejects words, numbers and look-alikes", () => {
    for (const bad of ["NAAN", "2500", "7K3O", "7K3I", "7K31", "7K", "7K3P2X", "zinger"]) expect(isValidCode(bad)).toBe(false);
  });
});

describe("finding a code in a message", () => {
  it("anywhere in the message, any case", () => {
    expect(findCodesInText("Hi! Mera order code: 7K3P 🛒\n2x Zinger Burger\n(Delivery)")).toEqual(["7K3P"]);
    expect(findCodesInText("7k3p")).toEqual(["7K3P"]);
    expect(findCodesInText("bhai ye raha mera code 7k3p jaldi bhej do")).toEqual(["7K3P"]);
    expect(findCodesInText("السلام علیکم! میرا آرڈر کوڈ: H8M2X 🛒")).toEqual(["H8M2X"]);
  });

  it("typed with spaces or dashes after the word 'code'", () => {
    expect(findCodesInText("code 7K 3P")).toEqual(["7K3P"]);
    expect(findCodesInText("order code: 7-k-3-p")).toEqual(["7K3P"]);
  });

  it("ordinary orders are not codes", () => {
    expect(findCodesInText("2 zinger aur ek large tikka pizza, 1.5L coke")).toEqual([]);
    expect(findCodesInText("char naan, total 2500")).toEqual([]);
    expect(mentionsOrderCode("Hi! Mera order code: ZZZZ")).toBe(true);
    expect(mentionsOrderCode("2 zinger burger")).toBe(false);
  });
});

describe("Urdu names fall back to English", () => {
  it("uses the Urdu name only in Urdu and only when there is one", () => {
    expect(pick("ur", "Zinger Burger", "زنگر برگر")).toBe("زنگر برگر");
    expect(pick("ur", "Loaded Fries", null)).toBe("Loaded Fries");
    expect(pick("ur", "Loaded Fries", "  ")).toBe("Loaded Fries");
    expect(pick("en", "Zinger Burger", "زنگر برگر")).toBe("Zinger Burger");
  });
});

describe("the WhatsApp message", () => {
  it("has the code first, the list for the customer, and the order type", () => {
    const msg = whatsappMessage("en", "7K3P", [{ quantity: 2, label: "Zinger Burger" }, { quantity: 1, label: "Large Chicken Tikka Pizza" }], "delivery");
    expect(msg).toBe("Hi! Mera order code: 7K3P 🛒\n2x Zinger Burger\n1x Large Chicken Tikka Pizza\n(Delivery)");
    expect(whatsappMessage("ur", "7K3P", [{ quantity: 1, label: "زنگر برگر" }], "pickup")).toBe("السلام علیکم! میرا آرڈر کوڈ: 7K3P 🛒\n1x زنگر برگر\n(پک اپ)");
    expect(findCodesInText(msg)).toEqual(["7K3P"]);
  });

  it("wa.me link with digits only", () => {
    expect(waLink("+92 300 1234567", "Hi! 7K3P")).toBe("https://wa.me/923001234567?text=Hi!%207K3P");
    expect(waLink("123", "x")).toBeNull();
  });

  it("texts exist in both languages", () => {
    expect(texts("ur").send).not.toBe(texts("en").send);
    expect(Object.keys(texts("ur")).sort()).toEqual(Object.keys(texts("en")).sort());
  });
});

describe("menu page links", () => {
  it("uses NEXT_PUBLIC_SITE_URL without a trailing slash", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://orderly.pk/" })).toBe("https://orderly.pk");
    expect(siteUrl({})).toBe("http://localhost:3000");
    expect(menuPageUrl("tandoori-junction", null, "https://orderly.pk")).toBe("https://orderly.pk/m/tandoori-junction");
    expect(menuPageUrl("tj", "b-1", "https://orderly.pk")).toBe("https://orderly.pk/m/tj?branch=b-1");
  });
});

describe("priceMenuItem (the page) = priceCartItem (the server)", () => {
  const m = createMemoryBotStore();
  const items = new Map(m.menu.categories.flatMap((c) => c.items).map((i) => [i.name, i]));
  const both = async (name: string, choice: { variantId?: string | null; modifierOptionIds?: string[]; removals?: string[]; quantity: number }) => {
    const item = items.get(name)!;
    const page = priceMenuItem(RESTAURANT_ID, BRANCH_ID, item, choice);
    const server = await m.store.priceLine({ restaurantId: RESTAURANT_ID, branchId: BRANCH_ID, itemId: item.id, ...choice });
    return { page, server, item };
  };

  it("same totals for sizes, extras and removals", async () => {
    const pizza = items.get("Chicken Tikka Pizza")!;
    const large = pizza.sizes.find((s) => s.name === "Large")!.id;
    const cheese = pizza.groups[0].options.find((o) => o.name === "Extra Cheese")!.id;
    const { page, server } = await both("Chicken Tikka Pizza", { variantId: large, modifierOptionIds: [cheese], removals: ["Olives"], quantity: 2 });
    expect(page.ok && server.ok).toBe(true);
    if (page.ok && server.ok) {
      expect(page.line.lineTotal).toBe(server.line.lineTotal);
      expect(page.line.lineTotal).toBe(2 * (185000 + 15000));
      expect(page.line.removals).toEqual(server.line.removals);
    }
  });

  it("same errors: size required, too many extras, required choice defaults", async () => {
    const noSize = await both("Chicken Tikka Pizza", { quantity: 1 });
    expect(noSize.page.ok).toBe(false);
    expect(!noSize.page.ok && noSize.page.errors[0].code).toBe("SIZE_REQUIRED");
    expect(!noSize.server.ok && noSize.server.errors[0].code).toBe("SIZE_REQUIRED");

    const pizza = items.get("Chicken Tikka Pizza")!;
    const all = pizza.groups[0].options.map((o) => o.id);
    const tooMany = await both("Chicken Tikka Pizza", { variantId: pizza.sizes[0].id, modifierOptionIds: [...all, ...all.slice(0, 1)], quantity: 1 });
    expect(tooMany.page.ok).toBe(tooMany.server.ok);

    const biryani = await both("Chicken Biryani", { quantity: 1 }); // spice level: default "Medium" applied
    expect(biryani.page.ok && biryani.server.ok && biryani.page.line.options.map((o) => o.name)).toEqual(["Medium"]);
  });

  it("sold out → can't be added", async () => {
    const fries = await both("Loaded Fries", { quantity: 1 });
    expect(!fries.page.ok && fries.page.errors[0].code).toBe("ITEM_OUT_OF_STOCK");
    expect(!fries.server.ok && fries.server.errors[0].code).toBe("ITEM_OUT_OF_STOCK");
  });
});
