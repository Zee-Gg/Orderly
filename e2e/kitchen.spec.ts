import { expect, test } from "@playwright/test";
import { createOrder } from "../src/lib/orders/engine";
import { admin, cleanup, createTestUser, type TestUser } from "./helpers";

/**
 * Accept an order on /orders → it appears on /kitchen → START → READY →
 * the orders dashboard moves it to Ready. Real app, real database, real realtime.
 */
const RUN = Date.now().toString(36);
const restaurants: string[] = [];
const users: string[] = [];
let owner: TestUser;
let kitchen: TestUser;
let orderNumber: number;

test.beforeAll(async () => {
  owner = await createTestUser("owner", RUN);
  kitchen = await createTestUser("kitchen", RUN);
  users.push(owner.id, kitchen.id);

  const hours = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { closed: false, open: "00:00", close: "23:59" }]),
  );
  const { data: restaurantId, error } = await owner.client.rpc("create_restaurant_with_owner", {
    p_name: "E2E Kitchen",
    p_slug: `e2e-${RUN}`,
    p_city: "Lahore",
    p_phone: "",
    p_branch_name: "Main",
    p_branch_address: "",
    p_branch_area: "",
    p_opening_hours: hours,
  });
  if (error || !restaurantId) throw error;
  restaurants.push(restaurantId);
  await owner.client.from("memberships").insert({ user_id: kitchen.id, restaurant_id: restaurantId, role: "kitchen" });

  const { data: branch } = await admin.from("branches").select("id").eq("restaurant_id", restaurantId).single();
  const { data: cat } = await admin.from("menu_categories").insert({ restaurant_id: restaurantId, name: "Burgers" }).select("id").single();
  const { data: item } = await admin
    .from("menu_items")
    .insert({ restaurant_id: restaurantId, category_id: cat!.id, name: "Zinger Burger", base_price: 55000, removable_options: ["Mayo"] })
    .select("id")
    .single();

  const created = await createOrder(
    { admin, pricing: admin },
    { restaurantId, branchIds: null },
    {
      branchId: branch!.id,
      idempotencyKey: `e2e-${RUN}`,
      source: "whatsapp",
      orderType: "pickup",
      paymentMethod: "cod",
      customer: { phone: "0300-5550001", name: "E2E Customer" },
      lines: [{ itemId: item!.id, quantity: 2, removals: ["Mayo"] }],
    },
    { type: "bot", userId: null, role: null },
    { initialStatus: "awaiting_acceptance" },
  );
  if (!created.ok) throw new Error(created.message);
  orderNumber = created.data.orderNumber;
});

test.afterAll(async () => {
  await cleanup(restaurants, users);
});

test("accept on /orders → kitchen START → READY → dashboard updates", async ({ browser }) => {
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ownerContext.addCookies(owner.cookies);
  const dashboard = await ownerContext.newPage();

  const kitchenContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await kitchenContext.addCookies(kitchen.cookies);
  const kitchenPage = await kitchenContext.newPage();

  // Kitchen screen open first, with nothing to cook yet.
  await kitchenPage.goto("/kitchen");
  await expect(kitchenPage.getByText("No orders to cook")).toBeVisible();

  // Accept on the orders dashboard.
  await dashboard.goto("/orders");
  const card = dashboard.locator(`[data-order-number="${orderNumber}"]:visible`);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(dashboard.getByRole("region", { name: "Preparing" }).getByText(`#${orderNumber}`)).toBeVisible();

  // It appears on the kitchen screen by itself (realtime), with the removal in red caps.
  const ticket = kitchenPage.getByRole("article", { name: `Order ${orderNumber}` });
  await expect(ticket).toBeVisible();
  await expect(ticket.getByText("2× Zinger Burger")).toBeVisible();
  await expect(ticket.getByText("× NO Mayo")).toBeVisible();
  await expect(ticket).not.toContainText("0300");

  await ticket.getByRole("button", { name: "START" }).click();
  await ticket.getByRole("button", { name: /READY/ }).click();
  await expect(ticket.getByText("Waiting for pickup")).toBeVisible();

  // The dashboard updates by itself and shows it in Ready.
  await expect(dashboard.getByRole("region", { name: "Ready" }).getByText(`#${orderNumber}`)).toBeVisible();

  const { data: order } = await admin.from("orders").select("status").eq("order_number", orderNumber).eq("restaurant_id", restaurants[0]).single();
  expect(order?.status).toBe("ready");

  await ownerContext.close();
  await kitchenContext.close();
});
