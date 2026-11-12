import { expect, test, type Browser } from "@playwright/test";
import { seedDemoMenu } from "../src/lib/menu/demo-menu-seed";
import { createOrder, transitionOrder } from "../src/lib/orders/engine";
import { admin, cleanup, createTestUser, type TestUser } from "./helpers";

/**
 * Phase 9: the owner adds a rider and assigns an order on the dashboard; the
 * rider logs in with phone + PIN on a phone, picks up and delivers with cash;
 * the dashboard updates live; the owner settles the cash. Wrong PINs lock.
 */
const RUN = Date.now().toString(36);
const restaurants: string[] = [];
const users: string[] = [];
let owner: TestUser;
let restaurantId: string;
let branchId: string;
let orderId: string;
let orderNumber: number;
const phoneDigits = `0300${String(Date.now()).slice(-7)}`;
const PIN = "482915";
const ALL_DAY = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { closed: false, open: "00:00", close: "23:59" }]));

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  owner = await createTestUser("riders", RUN);
  users.push(owner.id);
  const { data, error } = await owner.client.rpc("create_restaurant_with_owner", {
    p_name: "Tandoori Junction",
    p_slug: `riders-${RUN}`,
    p_city: "Lahore",
    p_phone: "03001234567",
    p_branch_name: "DHA",
    p_branch_address: "12 Main Boulevard, DHA",
    p_branch_area: "DHA",
    p_opening_hours: ALL_DAY as never,
  });
  if (error || !data) throw error;
  restaurantId = data;
  restaurants.push(restaurantId);
  const { data: b } = await admin.from("branches").select("id").eq("restaurant_id", restaurantId).single();
  branchId = b!.id;
  const items = await seedDemoMenu(admin, restaurantId, branchId);
  const deps = { admin, pricing: admin };
  const scope = { restaurantId, branchIds: [branchId] };
  const actor = { type: "staff" as const, userId: owner.id, role: "owner" as const };
  const created = await createOrder(
    deps,
    scope,
    {
      branchId,
      idempotencyKey: `riders-${RUN}`,
      source: "phone",
      orderType: "delivery",
      paymentMethod: "cod",
      customer: { phone: "0300-5550123", name: "Hamza Tariq" },
      address: { addressText: "House 12-B, Street 4", area: "DHA Phase 5", landmark: "near Masjid", save: true },
      deliveryFee: 15000,
      lines: [{ itemId: items["Zinger Burger"], quantity: 2 }],
    },
    actor,
    { initialStatus: "accepted" },
  );
  if (!created.ok) throw new Error(created.message);
  orderId = created.data.id;
  orderNumber = created.data.orderNumber;
  const moved = await transitionOrder(deps, scope, { orderId, expectedVersion: 1, path: ["preparing", "ready"] }, actor);
  if (!moved.ok) throw new Error(moved.message);
});

test.afterAll(async () => {
  const { data: riders } = await admin.from("rider_profiles").select("user_id").eq("restaurant_id", restaurantId);
  for (const r of riders ?? []) users.push(r.user_id);
  await cleanup(restaurants, users);
});

async function riderPhone(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  return { context, page: await context.newPage() };
}

test("owner adds a rider and assigns the ready order", async ({ page, context }) => {
  await context.addCookies(owner.cookies);
  await page.goto("/riders");
  await page.getByRole("button", { name: "Add rider" }).click();
  await page.getByLabel("Name").fill("Kashif");
  await page.getByLabel("Phone number").fill(phoneDigits);
  await page.getByLabel("6-digit PIN").fill(PIN);
  await page.getByRole("dialog").getByRole("button", { name: "Add rider" }).click();
  await expect(page.getByTestId("rider-login-details")).toContainText(PIN);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator('[data-testid="rider-row"][data-rider="Kashif"]')).toContainText("Offline");

  await page.goto("/orders");
  const card = page.locator(`[data-order-number="${orderNumber}"]`);
  await expect(card).toBeVisible();
  await card.getByTestId("assign-rider").selectOption({ label: "Kashif · offline · 0 active" });
  await expect(card.getByTestId("card-rider")).toContainText("Kashif");
  const { data: ev } = await admin.from("order_events").select("event_type").eq("order_id", orderId).eq("event_type", "rider_assigned");
  expect(ev).toHaveLength(1);
});

test("wrong PINs lock the rider login", async ({ browser }) => {
  const { context, page } = await riderPhone(browser);
  const lockPhone = `0301${String(Date.now()).slice(-7)}`;
  await page.goto("/rider/login");
  for (let i = 1; i <= 5; i++) {
    await page.getByLabel(/Phone number/).fill(lockPhone);
    await page.getByLabel(/PIN/).fill("000000");
    await page.getByRole("button", { name: "Login" }).click();
    const left = 5 - i;
    await expect(page.locator("form [role=alert]")).toContainText(left ? `${left} ${left === 1 ? "try" : "tries"} left` : "Too many wrong PINs");
  }
  // Even the right PIN is refused while locked.
  await page.getByLabel(/Phone number/).fill(lockPhone);
  await page.getByLabel(/PIN/).fill("123456");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.locator("form [role=alert]")).toContainText("Try again in");
  await context.close();
  await admin.from("rider_login_attempts").delete().like("phone", `%${lockPhone.slice(1)}`);
});

test("rider: phone + PIN → picked up → delivered with cash; dashboard updates live; owner settles", async ({ browser, page, context }) => {
  test.setTimeout(180_000);
  // The owner's dashboard stays open to see live updates.
  await context.addCookies(owner.cookies);
  await page.goto("/orders");
  const ownerCard = page.locator(`[data-order-number="${orderNumber}"]`);
  await expect(page.getByRole("region", { name: "Ready" }).locator(`[data-order-number="${orderNumber}"]`)).toBeVisible();

  const rider = await riderPhone(browser);
  await rider.page.goto("/rider");
  await expect(rider.page).toHaveURL(/\/rider\/login/);
  await rider.page.getByLabel(/Phone number/).fill(phoneDigits);
  await rider.page.getByLabel(/PIN/).fill(PIN);
  await rider.page.getByRole("button", { name: "Login" }).click();
  await expect(rider.page.getByTestId("rider-screen")).toBeVisible();
  await rider.page.getByTestId("online-toggle").click();
  await expect(rider.page.getByTestId("online-toggle")).toContainText("ONLINE");

  const card = rider.page.locator(`[data-testid="rider-order"][data-order="${orderNumber}"]`);
  await expect(card).toContainText("Food ready — pick up");
  await expect(card).toContainText("Hamza Tariq");
  await expect(card).toContainText("DHA Phase 5");
  await expect(card.getByTestId("collect")).toContainText("Rs 1,250"); // 2 × 550 + 150
  await expect(card.getByRole("link", { name: /Call/ })).toHaveAttribute("href", "tel:+923005550123");
  await rider.page.screenshot({ path: "test-results/riders/01-rider-ready.png" });

  await card.getByRole("button", { name: /Picked up/ }).click();
  await expect(card).toContainText("On the way");
  // Live on the dashboard (no reload).
  await expect(page.getByRole("region", { name: "Out for delivery" }).locator(`[data-order-number="${orderNumber}"]`)).toBeVisible();
  await expect(ownerCard.getByTestId("card-rider")).toContainText("Kashif");

  await card.getByRole("button", { name: /Delivered/ }).click();
  await expect(card.getByTestId("cash-confirm")).toContainText("Cash collected Rs 1,250?");
  await card.getByRole("button", { name: "Yes ✓" }).click();
  await expect(rider.page.getByTestId("no-orders")).toBeVisible();
  await expect(rider.page.getByTestId("cash-in-hand")).toHaveText("Rs 1,250");
  await expect(rider.page.getByTestId("rider-summary")).toContainText("1 delivery");
  await rider.page.screenshot({ path: "test-results/riders/02-rider-done.png" });
  await expect(ownerCard).toHaveCount(0); // delivered → off the board
  const { data: row } = await admin.from("orders").select("status, cod_collected_amount, payment_status").eq("id", orderId).single();
  expect(row).toEqual({ status: "delivered", cod_collected_amount: 125000, payment_status: "paid" });

  // Owner settles the cash.
  await page.goto("/riders");
  const riderRow = page.locator('[data-testid="rider-row"][data-rider="Kashif"]');
  await expect(riderRow.getByTestId("rider-cash")).toHaveText("Rs 1,250");
  await riderRow.getByRole("button", { name: "Settle cash" }).click();
  await expect(page.getByTestId("settle-expected")).toHaveText("Rs 1,250");
  await page.getByRole("button", { name: "Confirm received" }).click();
  await expect(riderRow.getByTestId("rider-cash")).toHaveText("Rs 0");
  await rider.page.reload();
  await expect(rider.page.getByTestId("cash-in-hand")).toHaveText("Rs 0");
  await rider.context.close();
});
