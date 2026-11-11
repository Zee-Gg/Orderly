import { expect, test } from "@playwright/test";
import { runBotConversations } from "../scripts/lib/whatsapp-conversation";
import { admin } from "./helpers";

/**
 * The AI bot on WhatsApp, end to end through SIGNED webhooks: the server runs
 * with the fake Graph API and the rule-based fake AI (playwright.config.ts).
 * Same scenarios as `npm run whatsapp:fake -- --conversation`.
 */
test("bot conversations: full order with buttons and location, batching, handoff, flood limit, voice note", async () => {
  test.setTimeout(240_000);
  const failed: string[] = [];
  await runBotConversations({
    admin,
    endpoint: "http://localhost:3123/api/webhooks/whatsapp",
    appSecret: process.env.WHATSAPP_APP_SECRET!,
    supabase: { url: process.env.NEXT_PUBLIC_SUPABASE_URL!, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
    check: (name, pass, detail) => {
      if (!pass) failed.push(`${name} → ${JSON.stringify(detail)?.slice(0, 400)}`);
    },
  });
  expect(failed).toEqual([]);
});
