import path from "node:path";
import { expect, test } from "@playwright/test";
import { seedDemoMenu } from "../src/lib/menu/demo-menu-seed";
import { admin, cleanup, createTestUser, type TestUser } from "./helpers";

/**
 * /settings/bot (Phase 7C): upload a real menu photo (compressed to JPEG in
 * the browser), the "old prices" banner, common questions, an offer linked to
 * a menu item (price from the menu), and a pasted Google Maps link.
 */
const RUN = Date.now().toString(36);
const restaurants: string[] = [];
const users: string[] = [];
let owner: TestUser;
let restaurantId: string;
let branchId: string;

test.beforeAll(async () => {
  owner = await createTestUser("botknow", RUN);
  users.push(owner.id);
  const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { closed: false, open: "00:00", close: "23:59" }]));
  const { data, error } = await owner.client.rpc("create_restaurant_with_owner", {
    p_name: "Tandoori Junction",
    p_slug: `botknow-${RUN}`,
    p_city: "Lahore",
    p_phone: "03001234567",
    p_branch_name: "DHA Branch",
    p_branch_address: "12 Main Boulevard, DHA Phase 5",
    p_branch_area: "DHA",
    p_opening_hours: hours,
  });
  if (error || !data) throw error;
  restaurantId = data;
  restaurants.push(restaurantId);
  const { data: branch } = await admin.from("branches").select("id").eq("restaurant_id", restaurantId).single();
  branchId = branch!.id;
  await seedDemoMenu(admin, restaurantId, branchId);
});

test.afterAll(async () => {
  const { data: files } = await admin.storage.from("bot-media").list(`${restaurantId}/menu`);
  if (files?.length) await admin.storage.from("bot-media").remove(files.map((f) => `${restaurantId}/menu/${f.name}`));
  await cleanup(restaurants, users);
});

test("owner teaches the bot: menu image, banner, questions, offer, location", async ({ page, context }) => {
  test.setTimeout(180_000);
  await context.addCookies(owner.cookies);

  // --- Menu image: a 0.5 MB PNG becomes a JPEG under 1 MB, max 1600px.
  await page.goto("/settings/bot");
  await expect(page.getByRole("heading", { name: "Menu images and PDF" })).toBeVisible();
  await page.getByTestId("menu-media-file").setInputFiles(path.resolve(process.cwd(), "e2e/fixtures/menu-tandoori.png"));
  await expect(page.getByTestId("menu-media-row")).toHaveCount(1);
  const { data: media } = await admin.from("menu_media").select("type, storage_path, size_bytes, file_name").eq("restaurant_id", restaurantId);
  expect(media).toHaveLength(1);
  expect(media![0]).toMatchObject({ type: "image", file_name: "menu-tandoori.png" });
  expect(media![0].storage_path).toMatch(new RegExp(`^${restaurantId}/menu/.+\\.jpg$`));
  expect(media![0].size_bytes).toBeLessThan(1024 * 1024);
  const pub = await fetch(admin.storage.from("bot-media").getPublicUrl(media![0].storage_path).data.publicUrl);
  expect(pub.headers.get("content-type")).toContain("image/jpeg");
  await expect(page.getByTestId("menu-image-outdated")).toHaveCount(0);

  // --- A price change after the upload → yellow banner here and on /menu.
  await admin.from("audit_logs").insert({
    restaurant_id: restaurantId,
    user_id: owner.id,
    action: "menu_item.price_changed",
    entity_type: "menu_item",
    entity_id: restaurantId,
    created_at: new Date(Date.now() + 1000).toISOString(),
  });
  await page.reload();
  await expect(page.getByTestId("menu-image-outdated")).toBeVisible();
  await page.goto("/menu");
  await expect(page.getByTestId("menu-image-outdated")).toBeVisible();

  // --- Common questions: 6 suggestions with blank answers.
  await page.goto("/settings/bot?tab=faqs");
  await page.getByRole("button", { name: "Add common questions" }).click();
  await expect(page.getByTestId("faq-row")).toHaveCount(6);
  await expect(page.getByText("No answer yet").first()).toBeVisible();
  await page.getByRole("button", { name: "Edit “Parking available?”" }).click();
  await page.getByLabel("Answer", { exact: true }).fill("Yes, free parking in front.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("faq-row").filter({ hasText: "free parking" })).toBeVisible();
  const { data: parking } = await admin.from("restaurant_faqs").select("answer, is_active").eq("restaurant_id", restaurantId).eq("question", "Parking available?").single();
  expect(parking).toEqual({ answer: "Yes, free parking in front.", is_active: true });

  // --- Offer: linked to the Friday Deal item; the price shown comes from the menu.
  await page.goto("/settings/bot?tab=offers");
  await page.getByRole("button", { name: "Add offer" }).click();
  await page.getByLabel("Offer name").fill("Friday Deal");
  await page.getByLabel("Search menu items").fill("friday");
  await page.getByRole("button", { name: /Friday Deal: 2 Zinger/ }).click();
  await expect(page.getByTestId("offer-item")).toContainText("Rs 1,199");
  await page.getByRole("button", { name: "Fri", exact: true }).click();
  await page.getByRole("button", { name: "Save offer" }).click();
  const offerRow = page.getByTestId("offer-row").filter({ hasText: "Friday Deal" });
  await expect(offerRow).toContainText("Rs 1,199");
  await expect(offerRow).toContainText("Fri");
  const { data: offer } = await admin.from("offers").select("days_of_week, menu_item_id, start_time").eq("restaurant_id", restaurantId).single();
  expect(offer).toMatchObject({ days_of_week: [5], start_time: null });

  // --- Location from a pasted Google Maps link.
  await page.goto("/settings/bot?tab=info");
  await page.getByLabel("Or paste a Google Maps link").fill("https://www.google.com/maps/place/Tandoori/@31.4697,74.4089,17z");
  await page.getByRole("button", { name: "Read link" }).click();
  await expect(page.getByTestId("branch-coords")).toContainText("31.4697, 74.4089");
  await page.getByLabel("Delivery time (minutes, on top of cooking time)").fill("25");
  await page.getByRole("button", { name: "Save DHA Branch" }).click();
  await expect.poll(async () => (await admin.from("branches").select("latitude, longitude, delivery_minutes").eq("id", branchId).single()).data).toEqual({
    latitude: 31.4697,
    longitude: 74.4089,
    delivery_minutes: 25,
  });
});
