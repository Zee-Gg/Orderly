import { expect, test } from "@playwright/test";
import { createOrder } from "../src/lib/orders/engine";
import { admin, cleanup, createTestUser, type TestUser } from "./helpers";

/**
 * KOT and bill print pages at 80mm and 58mm. Screenshots are saved to
 * test-results/receipts/ for a visual check.
 */
const RUN = Date.now().toString(36);
const restaurants: string[] = [];
const users: string[] = [];
let owner: TestUser;
let orderId: string;

test.beforeAll(async () => {
  owner = await createTestUser("printer", RUN);
  users.push(owner.id);
  const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { closed: true }]));
  const { data: restaurantId, error } = await owner.client.rpc("create_restaurant_with_owner", {
    p_name: "Tandoori Junction",
    p_slug: `print-${RUN}`,
    p_city: "Lahore",
    p_phone: "03001234567",
    p_branch_name: "DHA Branch",
    p_branch_address: "12 Main Boulevard, DHA Phase 5",
    p_branch_area: "DHA",
    p_opening_hours: hours,
  });
  if (error || !restaurantId) throw error;
  restaurants.push(restaurantId);
  await admin
    .from("restaurants")
    .update({ bill_header: "NTN 1234567", bill_footer: "Thank you! Order again on WhatsApp." })
    .eq("id", restaurantId);

  const { data: branch } = await admin.from("branches").select("id").eq("restaurant_id", restaurantId).single();
  const { data: cat } = await admin.from("menu_categories").insert({ restaurant_id: restaurantId, name: "Mains" }).select("id").single();
  const { data: pizza } = await admin
    .from("menu_items")
    .insert({ restaurant_id: restaurantId, category_id: cat!.id, name: "Chicken Tikka Pizza", base_price: 139900, removable_options: ["Olives"] })
    .select("id")
    .single();
  const { data: naan } = await admin
    .from("menu_items")
    .insert({ restaurant_id: restaurantId, category_id: cat!.id, name: "Garlic Naan", base_price: 12000 })
    .select("id")
    .single();
  const { data: group } = await admin.from("modifier_groups").insert({ restaurant_id: restaurantId, name: "Extras", min_select: 0, max_select: 2 }).select("id").single();
  const { data: cheese } = await admin
    .from("modifier_options")
    .insert({ restaurant_id: restaurantId, group_id: group!.id, name: "Extra Cheese", price_delta: 15000 })
    .select("id")
    .single();
  await admin.from("item_modifier_groups").insert({ restaurant_id: restaurantId, item_id: pizza!.id, group_id: group!.id });

  const created = await createOrder(
    { admin, pricing: admin },
    { restaurantId, branchIds: null },
    {
      branchId: branch!.id,
      idempotencyKey: `print-${RUN}`,
      source: "phone",
      orderType: "delivery",
      paymentMethod: "cod",
      customer: { phone: "0300-5550003", name: "Ayesha Khan" },
      address: { addressText: "House 12, Street 4", area: "Gulberg III", landmark: "Liberty Market", save: false },
      deliveryFee: 15000,
      notes: "Call at the gate",
      lines: [
        { itemId: pizza!.id, quantity: 1, optionIds: [cheese!.id], removals: ["Olives"], notes: "Well done" },
        { itemId: naan!.id, quantity: 4 },
      ],
    },
    { type: "staff", userId: owner.id, role: "owner" },
  );
  if (!created.ok) throw new Error(created.message);
  orderId = created.data.id;
});

test.afterAll(async () => {
  await cleanup(restaurants, users);
});

for (const width of ["80", "58"] as const) {
  test(`KOT and bill render at ${width}mm`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
    await context.addCookies(owner.cookies);
    const page = await context.newPage();

    await page.goto(`/print/kot/${orderId}?preview=1&width=${width}`);
    const kot = page.locator('[data-receipt="kot"]');
    await expect(kot).toBeVisible();
    await expect(kot).toContainText("1× Chicken Tikka Pizza");
    await expect(kot).toContainText("× NO Olives");
    await expect(kot).toContainText("+ Extra Cheese");
    await expect(kot).not.toContainText("Rs "); // no prices on the kitchen slip
    await expect(kot).not.toContainText("0300"); // no phone
    await kot.screenshot({ path: `test-results/receipts/kot-${width}mm.png` });

    await page.goto(`/print/bill/${orderId}?preview=1&width=${width}`);
    const bill = page.locator('[data-receipt="bill"]');
    await expect(bill).toBeVisible();
    await expect(bill).toContainText("Tandoori Junction");
    await expect(bill).toContainText("NTN 1234567");
    await expect(bill).toContainText("0300-5550003");
    await expect(bill).toContainText("Gulberg III");
    // 1,399 + 150 extra + 4 × 120 naan = 2,029 + 150 delivery = Rs 2,179
    await expect(bill).toContainText("Rs 2,179");
    await expect(bill).toContainText("Thank you! Order again on WhatsApp.");
    await bill.screenshot({ path: `test-results/receipts/bill-${width}mm.png` });

    await context.close();
  });
}

test("printing adds a 'printed' entry to the order timeline", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies(owner.cookies);
  const page = await context.newPage();
  await page.goto(`/print/kot/${orderId}`); // not a preview: prints, then logs
  await expect(page.locator('[data-receipt="kot"]')).toBeVisible();
  await expect
    .poll(async () => {
      const { data } = await admin.from("order_events").select("data").eq("order_id", orderId).eq("event_type", "printed");
      return data?.map((e) => (e.data as { kind?: string }).kind) ?? [];
    })
    .toContain("kot");
  await context.close();
});
