/**
 * Sends one message of each kind through the REAL WhatsApp Cloud API, to
 * check the Phase 7 helpers end to end:
 *   text, image, document, location, reply buttons, list.
 *
 *   npm run whatsapp:send-test -- <restaurant-slug> --to 923001234567
 *                                [--image https://…png] [--pdf https://…pdf]
 *
 * The number must have messaged the restaurant in the last 24 hours (no
 * templates): otherwise every helper is skipped, which is also shown.
 * Every message is saved and shows in /inbox.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import { createSender, isInside24hWindow, type SendResult } from "../src/lib/whatsapp/send";
import { createSupabaseStore } from "../src/lib/whatsapp/store";

process.loadEnvFile(".env.local");

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const slug = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const to = flag("to")?.replace(/\D/g, "");
const imageUrl = flag("image") ?? "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png";
const pdfUrl = flag("pdf") ?? "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

async function main() {
  if (!slug || !to) {
    console.log("Usage: npm run whatsapp:send-test -- <restaurant-slug> --to 923001234567");
    process.exit(1);
  }
  const db: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: restaurant } = await db.from("restaurants").select("id, name").eq("slug", slug).maybeSingle();
  if (!restaurant) throw new Error(`No restaurant with slug "${slug}"`);

  const store = createSupabaseStore(db);
  const conversation = await store.findConversation(restaurant.id, to);
  console.log(`Restaurant: ${restaurant.name} → +${to}`);
  console.log(
    conversation
      ? `Last customer message: ${conversation.lastCustomerMessageAt} (inside 24h window: ${isInside24hWindow(conversation)})`
      : "This number has never messaged the restaurant: everything will be skipped.",
  );

  const s = createSender({ store });
  const steps: [string, () => Promise<SendResult>][] = [
    ["sendText", () => s.sendText(restaurant.id, to, "Orderly test 1/6: text ✅")],
    ["sendImage", () => s.sendImage(restaurant.id, to, imageUrl, "Orderly test 2/6: image")],
    ["sendDocument", () => s.sendDocument(restaurant.id, to, pdfUrl, "orderly-test.pdf", "Orderly test 3/6: document")],
    ["sendLocation", () => s.sendLocation(restaurant.id, to, 24.8138, 67.0299, "Orderly test 4/6", "Clifton, Karachi")],
    [
      "sendInteractiveButtons",
      () =>
        s.sendInteractiveButtons(restaurant.id, to, "Orderly test 5/6: order confirm karein?", [
          { id: "confirm", title: "Haan, confirm" },
          { id: "change", title: "Change karna hai" },
        ]),
    ],
    [
      "sendInteractiveList",
      () =>
        s.sendInteractiveList(restaurant.id, to, "Orderly test 6/6: size choose karein", "Sizes", [
          { title: "Pizza", rows: [{ id: "small", title: "Small", description: "Rs 650" }, { id: "large", title: "Large", description: "Rs 1,450" }] },
        ]),
    ],
  ];

  let failed = 0;
  for (const [name, run] of steps) {
    const r = await run();
    if (r.ok) console.log(`  \x1b[32mSENT\x1b[0m    ${name} (${r.waMessageId})`);
    else {
      if (r.status === "failed") failed++;
      console.log(`  ${r.status === "skipped" ? "\x1b[33mSKIPPED\x1b[0m" : "\x1b[31mFAILED\x1b[0m "} ${name}: ${r.error}`);
    }
  }
  console.log(failed ? `\n\x1b[31m${failed} failed\x1b[0m` : "\nDone. Check the phone and /inbox.");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("\x1b[31mCrashed:\x1b[0m", err instanceof Error ? err.message : err);
  process.exit(1);
});
