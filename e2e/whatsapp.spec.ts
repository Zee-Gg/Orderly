import { expect, test } from "@playwright/test";
import { encryptToken } from "../src/lib/whatsapp/crypto";
import { signPayload } from "../src/lib/whatsapp/signature";
import { admin, cleanup, createTestUser, type TestUser } from "./helpers";

/**
 * A signed fake webhook → the message shows in /inbox; /settings/whatsapp
 * shows the number (never the token) and the QR code. Photos and voice notes
 * are downloaded (from the fake Graph API, e2e/mock-graph.ts) into Storage.
 * Screenshots in test-results/whatsapp/.
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
  for (const id of restaurants) {
    const { data: files } = await admin.storage.from("whatsapp-media").list(id);
    if (files?.length) await admin.storage.from("whatsapp-media").remove(files.map((f) => `${id}/${f.name}`));
  }
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
  // The greeting went out through the fake Graph API.
  await expect(thread.locator('[data-direction="outbound"]')).toContainText("Karachi Biryani House");
  await expect(page.locator("body")).not.toContainText(TOKEN); // Meta echoes tokens in errors: must be redacted
  await page.screenshot({ path: "test-results/whatsapp/inbox.png" });

  await page.goto("/settings/whatsapp");
  await expect(page.getByText("+92 321 5550000")).toBeVisible();
  await expect(page.getByRole("img", { name: /QR code that opens WhatsApp/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "wa.me/923215550000" })).toHaveAttribute(
    "href",
    "https://wa.me/923215550000?text=Hi%2C%20I%20want%20to%20order",
  );
  const png = await context.request.get("/api/whatsapp/qr");
  expect(png.headers()["content-type"]).toBe("image/png");
  await expect(page.locator("body")).not.toContainText(TOKEN);
  await page.screenshot({ path: "test-results/whatsapp/settings.png", fullPage: true });

  await page.goto("/print/whatsapp-poster?preview=1");
  await expect(page.getByRole("heading", { name: "Karachi Biryani House" })).toBeVisible();
  await expect(page.getByText("Scan to order on WhatsApp")).toBeVisible();
  await expect(page.getByRole("img", { name: "QR code to open WhatsApp chat" })).toBeVisible();
  await page.screenshot({ path: "test-results/whatsapp/poster.png", fullPage: true });
  await context.close();
});

test("photos and voice notes are saved to storage and shown in the inbox", async ({ browser, request }) => {
  const ts = String(Math.floor(Date.now() / 1000));
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
              contacts: [{ profile: { name: "Sana Malik" }, wa_id: "923007778899" }],
              messages: [
                { from: "923007778899", id: `wamid.img${RUN}`, timestamp: ts, type: "image", image: { id: `IMG${RUN}`, mime_type: "image/png", caption: "Yeh wala menu" } },
                { from: "923007778899", id: `wamid.aud${RUN}`, timestamp: ts, type: "audio", audio: { id: `AUD${RUN}`, mime_type: "audio/ogg; codecs=opus" } },
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

  // Both files end up in the private bucket under {restaurant_id}/ and are linked to their messages.
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("whatsapp_messages")
        .select("type, media_url, media_mime_type")
        .in("wa_message_id", [`wamid.img${RUN}`, `wamid.aud${RUN}`]);
      return (data ?? [])
        .map(({ type, media_url, media_mime_type }) => ({ type, media_mime_type, stored: !!media_url }))
        .sort((a, b) => a.type.localeCompare(b.type));
    })
    .toEqual([
      { type: "audio", media_mime_type: "audio/ogg", stored: true },
      { type: "image", media_mime_type: "image/png", stored: true },
    ]);
  const { data: saved } = await admin
    .from("whatsapp_messages")
    .select("id, type, media_url")
    .in("wa_message_id", [`wamid.img${RUN}`, `wamid.aud${RUN}`]);
  for (const m of saved ?? []) expect(m.media_url).toBe(`${restaurants[0]}/${m.id}.${m.type === "audio" ? "ogg" : "png"}`);
  const { data: image } = await admin.from("whatsapp_messages").select("media_url").eq("wa_message_id", `wamid.img${RUN}`).single();
  const { data: file } = await admin.storage.from("whatsapp-media").download(image!.media_url!);
  expect(file?.size).toBeGreaterThan(0);

  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.addCookies(owner.cookies);
  const page = await context.newPage();
  await page.goto("/inbox");
  await page.getByRole("link", { name: /Sana Malik/ }).click();
  const thread = page.getByRole("region", { name: /Chat with Sana Malik/ });
  const photo = thread.getByRole("img", { name: "Photo from the chat" });
  await expect(photo).toBeVisible();
  // A signed URL that really loads (Storage RLS lets this owner read their folder).
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1);
  expect(await photo.getAttribute("src")).toContain("/storage/v1/object/sign/whatsapp-media/");
  await expect(thread.getByLabel("Voice note", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/whatsapp/media.png" });
  await context.close();
});
