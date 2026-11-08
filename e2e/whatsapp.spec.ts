import { expect, test } from "@playwright/test";
import { encryptToken } from "../src/lib/whatsapp/crypto";
import { signPayload } from "../src/lib/whatsapp/signature";
import { admin, cleanup, createTestUser, type TestUser } from "./helpers";

/**
 * A signed fake webhook → the message shows in /inbox; /settings/whatsapp
 * shows the number (never the token). Screenshots in test-results/whatsapp/.
 */
const RUN = Date.now().toString(36);
const restaurants: string[] = [];
const users: string[] = [];
const PHONE_NUMBER_ID = `7${Date.now()}`;
const TOKEN = `EAAG-secret-${RUN}`;
let owner: TestUser;

test.beforeAll(async () => {
  owner = await createTestUser("wa-owner", RUN);
  users.push(owner.id);
  const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { closed: false, open: "00:00", close: "23:59" }]));
  const { data: restaurantId, error } = await owner.client.rpc("create_restaurant_with_owner", {
    p_name: "Karachi Biryani House",
    p_slug: `wa-${RUN}`,
    p_city: "Karachi",
    p_phone: "03001234567",
    p_branch_name: "Clifton",
    p_branch_address: "Block 5, Clifton",
    p_branch_area: "Clifton",
    p_opening_hours: hours,
  });
  if (error || !restaurantId) throw error;
  restaurants.push(restaurantId);
  const { error: accErr } = await admin.from("whatsapp_accounts").insert({
    restaurant_id: restaurantId,
    phone_number_id: PHONE_NUMBER_ID,
    waba_id: "1234567890",
    display_phone_number: "+92 321 5550000",
    access_token_encrypted: encryptToken(TOKEN),
  });
  if (accErr) throw accErr;
});

test.afterAll(async () => {
  await admin
    .from("whatsapp_webhook_events")
    .delete()
    .contains("raw", { entry: [{ changes: [{ value: { metadata: { phone_number_id: PHONE_NUMBER_ID } } }] }] });
  await cleanup(restaurants, users);
});

test("a WhatsApp message shows in the inbox", async ({ browser, request }) => {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "923215550000", phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ profile: { name: "Bilal Ahmed" }, wa_id: "923004445566" }],
              messages: [
                {
                  from: "923004445566",
                  id: `wamid.e2e${RUN}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: "2 chicken biryani chahiye, kitne ki hai?" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const res = await request.post("/api/webhooks/whatsapp", {
    data: body,
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signPayload(body, process.env.WHATSAPP_APP_SECRET!) },
  });
  expect(res.status()).toBe(200);

  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.addCookies(owner.cookies);
  const page = await context.newPage();
  await expect
    .poll(async () => {
      await page.goto("/inbox");
      return page.getByRole("link", { name: /Bilal Ahmed/ }).count();
    })
    .toBe(1);
  await page.getByRole("link", { name: /Bilal Ahmed/ }).click();
  const thread = page.getByRole("region", { name: /Chat with Bilal Ahmed/ });
  await expect(thread).toContainText("2 chicken biryani chahiye");
  // The greeting was attempted with a fake token, so it shows as failed (with its text).
  await expect(thread.locator('[data-direction="outbound"]')).toContainText("Karachi Biryani House");
  await expect(page.locator("body")).not.toContainText(TOKEN); // Meta echoes tokens in errors: must be redacted
  await page.screenshot({ path: "test-results/whatsapp/inbox.png" });

  await page.goto("/settings/whatsapp");
  await expect(page.getByText("+92 321 5550000")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(TOKEN);
  await page.screenshot({ path: "test-results/whatsapp/settings.png" });
  await context.close();
});
