import { expect, test, type Page } from "@playwright/test";
import { seedDemoKnowledge, seedDemoMenu } from "../src/lib/menu/demo-menu-seed";
import { encryptToken } from "../src/lib/whatsapp/crypto";
import { admin, cleanup, createTestUser, type TestUser } from "./helpers";

/**
 * The public customer menu /m/[slug] (Phase 8) on a phone-sized screen.
 * Screenshots for the visual check go to test-results/menu-page/.
 */
const RUN = Date.now().toString(36);
const restaurants: string[] = [];
const users: string[] = [];
let owner: TestUser;
const slugs = { open: `tj-${RUN}`, closed: `tj-closed-${RUN}`, suspended: `tj-off-${RUN}` };

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const ALL_DAY = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { closed: false, open: "00:00", close: "23:59" }]));
const NEVER = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { closed: true }]));

async function makeRestaurant(slug: string, name: string, hours: Record<string, unknown>) {
  const { data: id, error } = await owner.client.rpc("create_restaurant_with_owner", {
    p_name: name,
    p_slug: slug,
    p_city: "Lahore",
    p_phone: "03001234567",
    p_branch_name: "DHA Branch",
    p_branch_address: "12 Main Boulevard, DHA Phase 5",
    p_branch_area: "DHA",
    p_opening_hours: hours as never,
  });
  if (error || !id) throw error;
  restaurants.push(id);
  const { data: branch } = await admin.from("branches").select("id").eq("restaurant_id", id).single();
  await admin.from("branches").update({ default_delivery_fee: 15000, minimum_order: 50000, is_open: true }).eq("id", branch!.id);
  const itemIds = await seedDemoMenu(admin, id, branch!.id);
  await seedDemoKnowledge(admin, id, branch!.id, itemIds);
  await admin.from("whatsapp_accounts").insert({
    restaurant_id: id,
    branch_id: branch!.id,
    phone_number_id: `8${Date.now()}${restaurants.length}`.slice(0, 15),
    waba_id: "1234567890",
    display_phone_number: "+92 300 7654321",
    access_token_encrypted: encryptToken("fake"),
  });
  return { id, branchId: branch!.id };
}

test.beforeAll(async () => {
  owner = await createTestUser("menupage", RUN);
  users.push(owner.id);
  await makeRestaurant(slugs.open, "Tandoori Junction", ALL_DAY);
  await makeRestaurant(slugs.closed, "Night Kitchen", NEVER);
  const off = await makeRestaurant(slugs.suspended, "Gone Grill", ALL_DAY);
  await admin.from("restaurants").update({ status: "suspended" }).eq("id", off.id);
});

test.afterAll(async () => {
  await cleanup(restaurants, users);
});

const item = (page: Page, name: string) => page.locator(`[data-testid="menu-item"][data-item="${name}"]`);

test("browse, add with sizes and extras, edit the cart, send on WhatsApp", async ({ page, context }) => {
  await context.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>WhatsApp</p>" }));
  await page.goto(`/m/${slugs.open}`);
  await expect(page.getByRole("heading", { name: "Tandoori Junction" })).toBeVisible();
  await expect(page.getByTestId("open-status")).toContainText(/Open · Delivery \d+–\d+ min/);
  await expect(page.getByRole("link", { name: "Pizza" })).toBeVisible();
  await expect(item(page, "Loaded Fries")).toContainText("Sold out today");
  await expect(item(page, "Loaded Fries").getByRole("button", { name: /^Add/ })).toHaveCount(0);
  await expect(item(page, "Chicken Tikka Pizza")).toContainText("from Rs 899");
  await expect(item(page, "Zinger Burger")).toContainText("Bestseller");
  await page.screenshot({ path: "test-results/menu-page/01-menu.png", fullPage: false });

  // Pizza: size required, extras "Optional · up to 3", removal chip, note.
  await item(page, "Chicken Tikka Pizza").getByRole("button", { name: "Add Chicken Tikka Pizza" }).click();
  const sheet = page.getByRole("dialog", { name: "Chicken Tikka Pizza" });
  await expect(sheet.getByText("Choose size")).toBeVisible();
  await expect(sheet.getByText("Required")).toBeVisible();
  await expect(sheet.getByText("Optional · up to 3")).toBeVisible();
  await sheet.getByRole("radio", { name: /Large/ }).check();
  await sheet.getByRole("checkbox", { name: /Extra Cheese/ }).check();
  await sheet.getByRole("button", { name: "No olives" }).click();
  await sheet.getByPlaceholder("e.g. Spicy rakhna").fill("well done");
  await page.screenshot({ path: "test-results/menu-page/02-item-sheet.png" });
  await sheet.getByRole("button", { name: "Add to order — Rs 2,000" }).click();
  await expect(sheet).toHaveCount(0);

  // Zinger Deal: a required single choice ("Choose 1").
  await item(page, "Zinger Deal").getByRole("button", { name: "Add Zinger Deal" }).click();
  const deal = page.getByRole("dialog", { name: "Zinger Deal" });
  await expect(deal.getByText("Choose 1")).toBeVisible();
  await deal.getByRole("radio", { name: /Mint Margarita/ }).check();
  await deal.getByRole("button", { name: "Add to order — Rs 899" }).click();

  await item(page, "Zinger Burger").getByRole("button", { name: "Add Zinger Burger" }).click();
  await page.getByRole("dialog", { name: "Zinger Burger" }).getByRole("button", { name: "Add to order — Rs 550" }).click();
  await expect(page.getByTestId("cart-bar")).toContainText("3");
  await expect(page.getByTestId("cart-bar")).toContainText("Rs 3,449");

  // A refresh keeps the cart (localStorage).
  await page.reload();
  await expect(page.getByTestId("cart-bar")).toContainText("Rs 3,449");

  await page.getByTestId("cart-bar").click();
  const cart = page.getByTestId("cart-view");
  await expect(cart.getByTestId("cart-line")).toHaveCount(3);
  const zinger = cart.getByTestId("cart-line").filter({ hasText: "Zinger Burger" }).filter({ hasNotText: "Deal" });
  await zinger.getByRole("button", { name: "+" }).click();
  await expect(zinger).toContainText("Rs 1,100");
  const pizzaLine = cart.getByTestId("cart-line").filter({ hasText: "Chicken Tikka Pizza" });
  await expect(pizzaLine).toContainText("Large · + Extra Cheese");
  await expect(pizzaLine).toContainText("No olives");
  // Edit the pizza: Large → Medium.
  await pizzaLine.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Chicken Tikka Pizza" });
  await edit.getByRole("radio", { name: /Medium/ }).check();
  await edit.getByRole("button", { name: "Update — Rs 1,549" }).click();
  await expect(pizzaLine).toContainText("Rs 1,549");
  await cart.getByTestId("cart-line").filter({ hasText: "Zinger Deal" }).getByRole("button", { name: "Remove" }).click();
  await expect(cart.getByTestId("cart-line")).toHaveCount(2);
  const totals = cart.getByTestId("cart-totals");
  await expect(totals).toContainText("Rs 2,649"); // 1,549 + 1,100
  await expect(totals).toContainText("Rs 150");
  await expect(totals).toContainText("Rs 2,799");
  await expect(totals).toContainText("Final total will be confirmed on WhatsApp.");
  await page.screenshot({ path: "test-results/menu-page/03-cart.png", fullPage: true });

  const wa = page.waitForURL(/wa\.me/);
  await page.getByRole("button", { name: "Send order on WhatsApp" }).click();
  await wa;
  const url = new URL(page.url());
  expect(url.hostname).toBe("wa.me");
  expect(url.pathname).toBe("/923007654321");
  const text = url.searchParams.get("text")!;
  const code = text.match(/order code: ([A-Z2-9]{4,5})/)?.[1];
  expect(code).toBeTruthy();
  expect(text).toContain("1x Medium Chicken Tikka Pizza\n2x Zinger Burger\n(Delivery)");
  const { data: draft } = await admin.from("cart_drafts").select("order_type, lines, used_at").eq("code", code!).single();
  expect(draft).toMatchObject({ order_type: "delivery", used_at: null });
  expect((draft!.lines as unknown[]).length).toBe(2);
});

test("Urdu: RTL, Urdu names with English fallback, remembered after reload", async ({ page }) => {
  await page.goto(`/m/${slugs.open}`);
  await page.getByRole("button", { name: "اردو" }).click();
  const root = page.getByTestId("menu-page");
  await expect(root).toHaveAttribute("dir", "rtl");
  await expect(item(page, "Chicken Tikka Pizza")).toContainText("چکن تکہ پیزا");
  await expect(item(page, "Beef Smash Burger")).toContainText("Beef Smash Burger"); // no Urdu name → English
  await expect(page.getByTestId("open-status")).toContainText("کھلا ہے");
  await page.screenshot({ path: "test-results/menu-page/04-urdu.png" });
  await page.reload();
  await expect(page.getByTestId("menu-page")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(root).toHaveAttribute("dir", "ltr");
});

test("closed restaurant: browse yes, send no", async ({ page }) => {
  await page.goto(`/m/${slugs.closed}`);
  await expect(page.getByTestId("open-status")).toContainText("Closed");
  await item(page, "Raita").getByRole("button", { name: "Add Raita" }).click();
  await page.getByRole("dialog", { name: "Raita" }).getByRole("button", { name: /Add to order/ }).click();
  await page.getByTestId("cart-bar").click();
  await expect(page.getByTestId("send-blocked")).toContainText("We're closed now");
  await expect(page.getByRole("button", { name: "Send order on WhatsApp" })).toBeDisabled();
});

test("suspended or unknown restaurant: 'This menu is not available'", async ({ page }) => {
  await page.goto(`/m/${slugs.suspended}`);
  await expect(page.getByTestId("menu-not-available")).toContainText("This menu is not available");
  await page.goto(`/m/nobody-${RUN}`);
  await expect(page.getByTestId("menu-not-available")).toBeVisible();
});

test("link preview tags for WhatsApp / Instagram / Facebook", async ({ request }) => {
  const html = await (await request.get(`/m/${slugs.open}`)).text();
  expect(html).toContain('<meta property="og:title" content="Tandoori Junction — Order on WhatsApp"');
  expect(html).toContain('property="og:description"');
});
