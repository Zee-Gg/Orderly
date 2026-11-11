/**
 * Fake WhatsApp webhook: sends realistic, SIGNED Meta payloads to the local
 * endpoint so the whole flow can be tested without a real phone.
 *
 *   npm run whatsapp:fake                         # temp restaurant, checks, cleans up
 *   npm run whatsapp:fake -- <slug>               # use a connected restaurant (data stays → see /inbox)
 *   npm run whatsapp:fake -- <slug> --from 923001234567   # also receive the bot's reply on your own WhatsApp
 *   npm run whatsapp:fake -- --conversation       # full bot chats (temp restaurant with the demo menu)
 *   --url http://localhost:3000                   # where the app runs (default)
 *
 * Checks (default): bad signature rejected · text message saved · duplicate ignored ·
 * bot replied once · status updates (delivered → read) applied.
 *
 * --conversation plays full chats: an order with buttons + location pin +
 * Confirm (exactly one correct order), batching, handoff, flood limit, voice
 * note. Start the app with BOT_FAKE_AI=1 for exact checks (no real AI):
 *   PowerShell:  $env:BOT_FAKE_AI="1"; npm run dev
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/types/database";
import { encryptToken } from "../src/lib/whatsapp/crypto";
import { signPayload } from "../src/lib/whatsapp/signature";
import { runBotConversations } from "./lib/whatsapp-conversation";

process.loadEnvFile(".env.local");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const appSecret = process.env.WHATSAPP_APP_SECRET;
if (!appSecret) throw new Error("WHATSAPP_APP_SECRET is missing in .env.local");
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient<Database> = createClient<Database>(supabaseUrl, process.env.SUPABASE_SECRET_KEY!, noSession);

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const slug = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const baseUrl = (flag("--url") ?? "http://localhost:3000").replace(/\/$/, "");
const RUN = Date.now().toString(36);
const endpoint = `${baseUrl}/api/webhooks/whatsapp`;

let failures = 0;
function check(name: string, pass: boolean, detail?: unknown) {
  if (!pass) failures++;
  console.log(`  ${pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}${!pass && detail !== undefined ? `  → ${JSON.stringify(detail)}` : ""}`);
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 15_000): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

function envelope(phoneNumberId: string, value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "000000000000000",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15551556437", phone_number_id: phoneNumberId },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

function textMessage(phoneNumberId: string, from: string, id: string, body: string) {
  return envelope(phoneNumberId, {
    contacts: [{ profile: { name: "Test Customer" }, wa_id: from }],
    messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
  });
}

function statusUpdate(phoneNumberId: string, to: string, id: string, status: string) {
  return envelope(phoneNumberId, {
    statuses: [{ id, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: to }],
  });
}

async function post(payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature ?? signPayload(body, appSecret!) },
    body,
  });
  return res.status;
}

/** A throwaway restaurant + fake WhatsApp account (token is fake → replies fail, which is fine). */
async function createTempRestaurant() {
  const email = `wa-fake-${RUN}@example.com`;
  const password = `Wa-fake-${RUN}-Aa1!`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created.user) throw error ?? new Error("createUser failed");
  const client = createClient<Database>(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, noSession);
  await client.auth.signInWithPassword({ email, password });
  const hours = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { closed: false, open: "00:00", close: "23:59" }]));
  const { data: restaurantId, error: rErr } = await client.rpc("create_restaurant_with_owner", {
    p_name: "Fake Webhook Kitchen",
    p_slug: `wa-fake-${RUN}`,
    p_city: "Lahore",
    p_phone: "03001234567",
    p_branch_name: "Main",
    p_branch_address: "1 Test Road",
    p_branch_area: "Gulberg",
    p_opening_hours: hours,
  });
  if (rErr || !restaurantId) throw rErr ?? new Error("create restaurant failed");
  const phoneNumberId = `8${Date.now()}`;
  const { error: aErr } = await admin.from("whatsapp_accounts").insert({
    restaurant_id: restaurantId,
    phone_number_id: phoneNumberId,
    waba_id: "1234567890",
    display_phone_number: "+1 555 155 6437",
    access_token_encrypted: encryptToken("fake-token"),
  });
  if (aErr) throw aErr;
  return { restaurantId, phoneNumberId, userId: created.user.id };
}

async function main() {
  console.log(`Fake WhatsApp webhook → ${endpoint}`);
  if (args.includes("--conversation")) {
    const reachable = await fetch(endpoint, { method: "GET" }).then((r) => r.status).catch(() => 0);
    if (!reachable) throw new Error(`Cannot reach ${endpoint}. Is the app running (npm run dev)?`);
    console.log("Conversation mode (temporary restaurant with the demo menu; exact with BOT_FAKE_AI=1 on the server)");
    await runBotConversations({
      admin,
      endpoint,
      appSecret: appSecret!,
      supabase: { url: supabaseUrl, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
      check,
      log: (line) => console.log(`  ${line}`),
    });
    return;
  }
  let temp: Awaited<ReturnType<typeof createTempRestaurant>> | null = null;
  let restaurantId: string;
  let phoneNumberId: string;

  if (slug) {
    const { data: r } = await admin.from("restaurants").select("id, name").eq("slug", slug).maybeSingle();
    if (!r) throw new Error(`No restaurant with slug "${slug}"`);
    const { data: acc } = await admin
      .from("whatsapp_accounts")
      .select("phone_number_id, is_active")
      .eq("restaurant_id", r.id)
      .maybeSingle();
    if (!acc?.is_active) throw new Error(`${r.name} is not connected. Connect it in /admin/whatsapp first.`);
    restaurantId = r.id;
    phoneNumberId = acc.phone_number_id;
    console.log(`Using ${r.name} (phone number ID ${phoneNumberId})`);
  } else {
    temp = await createTempRestaurant();
    restaurantId = temp.restaurantId;
    phoneNumberId = temp.phoneNumberId;
    console.log("Using a temporary restaurant (removed at the end)");
  }

  // Default sender: a fictional number, so a real person never gets a reply.
  const from = (flag("--from") ?? (slug ? "15555550123" : "923009990123")).replace(/\D/g, "");
  const wamid = `wamid.FAKE${RUN}${Math.random().toString(36).slice(2, 8)}`;

  try {
    const reachable = await fetch(endpoint, { method: "GET" }).then((r) => r.status).catch(() => 0);
    if (!reachable) throw new Error(`Cannot reach ${endpoint}. Is the app running (npm run dev)?`);

    const bad = await post(textMessage(phoneNumberId, from, `${wamid}x`, "hi"), "sha256=deadbeef");
    check("Invalid signature is rejected (401)", bad === 401, bad);

    const ok = await post(textMessage(phoneNumberId, from, wamid, "Assalam o alaikum! Menu bhej dein please 🍕"));
    check("Signed text message accepted (200)", ok === 200, ok);
    const saved = await waitFor(async () => {
      const { data } = await admin
        .from("whatsapp_messages")
        .select("id, conversation_id, body")
        .eq("wa_message_id", wamid)
        .maybeSingle();
      return data;
    });
    check("Inbound message saved", !!saved, saved);
    if (!saved) return;

    const dup = await post(textMessage(phoneNumberId, from, wamid, "Assalam o alaikum! Menu bhej dein please 🍕"));
    await new Promise((r) => setTimeout(r, 2500));
    const { count } = await admin.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("wa_message_id", wamid);
    check("Duplicate delivery accepted but saved only once", dup === 200 && count === 1, { dup, count });

    const reply = await waitFor(async () => {
      const { data } = await admin
        .from("whatsapp_messages")
        .select("id, status, error, wa_message_id, body, created_at")
        .eq("conversation_id", saved.conversation_id)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0];
    }, 20_000);
    const { count: replies } = await admin
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", saved.conversation_id)
      .eq("direction", "outbound")
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());
    check(
      `Bot replied once (status: ${reply?.status ?? "none"}${reply?.error ? ` — ${reply.error}` : ""})`,
      !!reply && (replies ?? 0) <= 1,
      { reply, replies },
    );
    if (reply && reply.status !== "sent") {
      console.log("        (Expected with a fake token or a number outside the test recipients. The reply text is saved.)");
    }

    // Status updates need an outbound message with a wa_message_id.
    let outId = reply?.wa_message_id ?? null;
    if (!outId) {
      outId = `wamid.FAKEOUT${RUN}`;
      await admin.from("whatsapp_messages").insert({
        restaurant_id: restaurantId,
        conversation_id: saved.conversation_id,
        direction: "outbound",
        body: "(fake outbound message for the status test)",
        status: "sent",
        wa_message_id: outId,
        raw: { fake: true } as Json,
      });
    }
    await post(statusUpdate(phoneNumberId, from, outId, "delivered"));
    await post(statusUpdate(phoneNumberId, from, outId, "read"));
    const read = await waitFor(async () => {
      const { data } = await admin.from("whatsapp_messages").select("status").eq("wa_message_id", outId!).maybeSingle();
      return data?.status === "read" ? data : null;
    });
    check("Status updates applied (delivered → read)", !!read, read);
    await post(statusUpdate(phoneNumberId, from, outId, "delivered"));
    await new Promise((r) => setTimeout(r, 2000));
    const { data: after } = await admin.from("whatsapp_messages").select("status").eq("wa_message_id", outId).maybeSingle();
    check("A late 'delivered' does not undo 'read'", after?.status === "read", after);

    const { data: unknown } = await admin
      .from("whatsapp_webhook_events")
      .select("id, error, processed_at")
      .contains("raw", { entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId } } }] }] })
      .order("id", { ascending: false })
      .limit(10);
    check("Webhook events logged and processed", (unknown?.length ?? 0) >= 4 && unknown!.every((e) => e.processed_at), unknown);
  } finally {
    if (temp) {
      await admin
        .from("whatsapp_webhook_events")
        .delete()
        .contains("raw", { entry: [{ changes: [{ value: { metadata: { phone_number_id: temp.phoneNumberId } } }] }] });
      await admin.from("restaurants").delete().eq("id", temp.restaurantId);
      await admin.auth.admin.deleteUser(temp.userId);
      console.log("  Temporary restaurant removed.");
    } else {
      console.log(`  Open /inbox in ${slug} to see the chat.`);
    }
  }
}

main()
  .then(() => {
    console.log(failures ? `\n\x1b[31m${failures} check(s) failed\x1b[0m` : "\n\x1b[32mAll checks passed\x1b[0m");
    process.exit(failures ? 1 : 0);
  })
  .catch((err) => {
    console.error("\x1b[31mCrashed:\x1b[0m", err instanceof Error ? err.message : err);
    process.exit(1);
  });
