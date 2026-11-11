import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests. Uses the Chrome already installed on this machine
 * (channel "chrome") so no extra browser download is needed.
 * Needs a production build first: `npm run build`, then `npm run test:e2e`.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3123",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
  // Fake WhatsApp Graph API (e2e/mock-graph.ts): no real messages are ever sent.
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: "npm run start -- -p 3123",
    url: "http://localhost:3123/login",
    reuseExistingServer: true,
    timeout: 120_000,
    // Fake Graph API + rule-based fake AI (src/lib/bot/testing/fake-model.ts): no Meta, no AI provider.
    env: { WHATSAPP_GRAPH_BASE_URL: "http://localhost:3999", BOT_FAKE_AI: "1" },
  },
});
