import path from "node:path";
import { expect, test } from "@playwright/test";
import { createBotTestRestaurant, type BotTestRestaurant } from "../src/lib/bot/testing/test-restaurant";
import { admin, createTestUser, type TestUser } from "./helpers";

/**
 * Playground mic with Chrome's FAKE microphone (it plays a sample WAV).
 * The server uses the fake transcription + fake AI (playwright.config.ts), so
 * this checks the whole path: record → upload → Ogg → duration → transcript → bot.
 */
const sample = path.resolve(process.cwd(), "tests/voice-eval/fixtures/order-en.wav");
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${sample.replace(/\\/g, "/")}`],
  },
  permissions: ["microphone"],
});

const RUN = Date.now().toString(36);
let restaurant: BotTestRestaurant;
let superAdmin: TestUser;

test.beforeAll(async () => {
  restaurant = await createBotTestRestaurant(
    admin,
    { url: process.env.NEXT_PUBLIC_SUPABASE_URL!, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
    "mic",
  );
  superAdmin = await createTestUser("mic-admin", RUN);
  await admin.from("profiles").update({ is_super_admin: true }).eq("id", superAdmin.id);
});

test.afterAll(async () => {
  await restaurant?.cleanup();
  if (superAdmin) {
    await admin.from("profiles").update({ is_super_admin: false }).eq("id", superAdmin.id);
    await admin.auth.admin.deleteUser(superAdmin.id);
  }
});

test("playground mic: voice bubble, transcript, then the bot's reply", async ({ page, context }) => {
  await context.addCookies(superAdmin.cookies);
  await page.goto("/dev/bot-playground");
  await page.getByLabel("Restaurant").selectOption(restaurant.restaurantId);
  await page.getByLabel("Branch").selectOption(restaurant.openBranchId);
  await page.getByLabel("Name (optional)").fill("Mic Tester");
  await page.getByRole("button", { name: "Start chat" }).click();
  await expect(page.getByText(/New session · Mic Tester/)).toBeVisible();

  // Tap to start, wait, tap "send".
  await page.getByRole("button", { name: /Record a voice note/ }).click();
  await expect(page.getByRole("status")).toContainText("Recording");
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Send voice note" }).click();

  const bubble = page.getByTestId("voice-bubble");
  await expect(bubble).toBeVisible();
  await expect(bubble.getByLabel("Voice note")).toBeVisible(); // playable audio
  await expect(page.getByTestId("voice-transcript")).toHaveText("2 zinger burger aur ek coke", { timeout: 30_000 });
  await expect(page.getByText(/^🎤 Aap ne kaha: 2 Zinger Burger aur 1 Coke 1\.5L\. Theek hai\?$/)).toBeVisible({ timeout: 30_000 });

  const panel = page.getByTestId("voice-panel");
  await expect(panel).toContainText("fake transcription (tests)");
  await expect(panel).toContainText("WebM → Ogg"); // Chrome records WebM; the server makes it Ogg like WhatsApp
  await page.screenshot({ path: "test-results/voice/playground-mic.png", fullPage: true });
});
