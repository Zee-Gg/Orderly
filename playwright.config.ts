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
  webServer: {
    command: "npm run start -- -p 3123",
    url: "http://localhost:3123/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
