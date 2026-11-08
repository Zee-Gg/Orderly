import { expect, test } from "@playwright/test";
import { createOrder } from "../src/lib/orders/engine";
import { encryptToken } from "../src/lib/whatsapp/crypto";
import { admin, cleanup, createTestUser, type TestUser } from "./helpers";

/**
 * Accepting an order on /orders sends the customer a WhatsApp update
 * (through the fake Graph API in e2e/mock-graph.ts): an outbound message row
 * linked to the order is created, and it shows in the inbox.
 */
const RUN = Date.now().toString(36);
const restaurants: string[] = [];
const users: string[] = [];
const PHONE_NUMBER_ID = `8${Date.now()}`;
const CUSTOMER_WA_ID = "923005550002";
let owner: TestUser;
let orderId: string;
let orderNumber: number;

test.beforeAll(async () => {
  owner = await createTestUser("wa-orders", RUN);
  users.push(owner.id);
  const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { closed: false, open: "00:00", close: "23:59" }]));
  const { data: restaurantId, error } = await owner.client.rpc("create_restaurant_with_owner", {
    p_name: "Lahori Tikka",
    p_slug: `wao-${RUN}`,
    p_city: "Lahore",
    p_phone: "",
    p_branch_name: "Main",
    p_branch_address: "",
    p_branch_area: "",
    p_opening_hours: hours,
  });
  if (error || !restaurantId) throw error;
  restaurants.push(restaurantId);

  const { data: branch } = await admin.from("branches").select("id").eq("restaurant_id", restaurantId).single();
  const { data: cat } = await admin.from("menu_categories").insert({ restaurant_id: restaurantId, name: "BBQ" }).select("id").single();
  const { data: item } = await admin
    .from("menu_items")
    .insert({ restaurant_id: restaurantId, category_id: cat!.id, name: "Chicken Tikka", base_price: 65000 })
    .select("id")
    .single();

  await admin.from("whatsapp_accounts").insert({
    restaurant_id: restaurantId,
    phone_number_id: PHONE_NUMBER_ID,
    waba_id: "1234567890",
    display_phone_number: "+92 321 5550001",
    access_token_encrypted: encryptToken(`EAAG-e2e-${RUN}`),
  });
  // The customer wrote 10 minutes ago: inside the 24-hour window.
  await admin.from("whatsapp_conversations").insert({
    restaurant_id: restaurantId,
    wa_id: CUSTOMER_WA_ID,
    last_customer_message_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    last_message_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  });

  const created = await createOrder(
    { admin, pricing: admin },
    { restaurantId, branchIds: null },
    {
      branchId: branch!.id,
      idempotencyKey: `wao-${RUN}`,
      source: "whatsapp",
      orderType: "pickup",
      paymentMethod: "cod",
      customer: { phone: "0300-5550002", name: "Ayesha Khan" },
      lines: [{ itemId: item!.id, quantity: 1 }],
    },
    { type: "bot", userId: null, role: null },
    { initialStatus: "awaiting_acceptance" },
  );
  if (!created.ok) throw new Error(created.message);
  orderId = created.data.id;
  orderNumber = created.data.orderNumber;
});

test.afterAll(async () => {
  await cleanup(restaurants, users);
});

test("accepting an order on /orders sends the customer a WhatsApp update", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies(owner.cookies);
  const page = await context.newPage();

  await page.goto("/orders");
  const card = page.locator(`[data-order-number="${orderNumber}"]:visible`);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Accept", exact: true }).click();
  // The order action does not wait for WhatsApp: the card moves right away.
  await expect(page.getByRole("region", { name: "Preparing" }).getByText(`#${orderNumber}`)).toBeVisible();

  // The message is sent in the background (after the response).
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("whatsapp_messages")
        .select("direction, status, body, wa_message_id")
        .eq("order_id", orderId)
        .maybeSingle();
      return data;
    })
    .toMatchObject({ direction: "outbound", status: "sent", wa_message_id: expect.stringMatching(/^wamid\.mock\./) });

  const { data: message } = await admin.from("whatsapp_messages").select("body").eq("order_id", orderId).single();
  expect(message!.body).toContain(`Order #${orderNumber} confirm ho gaya!`);

  // Staff see it in the chat, marked as an order update.
  await page.goto("/inbox");
  await page.getByRole("link", { name: /0300-5550002/ }).click();
  const thread = page.getByRole("region", { name: /Chat with/ });
  await expect(thread).toContainText("Order update");
  await expect(thread).toContainText(`Order #${orderNumber} confirm ho gaya!`);
  await page.screenshot({ path: "test-results/whatsapp/order-update.png" });
  await context.close();
});
