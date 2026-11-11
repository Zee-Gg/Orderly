/**
 * Conversation mode of the fake WhatsApp webhook: plays full bot chats with
 * SIGNED Meta payloads against a running app and checks the results in the DB.
 *
 * Exact checks need the app started with BOT_FAKE_AI=1 (rule-based fake AI,
 * src/lib/bot/testing/fake-model.ts). With a real AI the chat can differ.
 * Used by `npm run whatsapp:fake -- --conversation` and e2e/whatsapp-bot.spec.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database";
import { createBotTestRestaurant } from "../../src/lib/bot/testing/test-restaurant";
import { encryptToken } from "../../src/lib/whatsapp/crypto";
import { signPayload } from "../../src/lib/whatsapp/signature";

type Admin = SupabaseClient<Database>;
export type Check = (name: string, pass: boolean, detail?: unknown) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 40_000): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(500);
  }
  return null;
}

export async function runBotConversations(opts: {
  admin: Admin;
  endpoint: string;
  appSecret: string;
  supabase: { url: string; publishableKey: string };
  check: Check;
  log?: (line: string) => void;
}) {
  const { admin, endpoint, appSecret, check } = opts;
  const log = opts.log ?? (() => {});
  const t = await createBotTestRestaurant(admin, opts.supabase, "conv");
  const phoneNumberId = `7${Date.now()}`;
  const { error: aErr } = await admin.from("whatsapp_accounts").insert({
    restaurant_id: t.restaurantId,
    branch_id: t.openBranchId,
    phone_number_id: phoneNumberId,
    waba_id: "1234567890",
    display_phone_number: "+1 555 155 6437",
    access_token_encrypted: encryptToken("fake-token"),
  });
  if (aErr) throw aErr;
  let seq = 0;

  const post = async (from: string, message: Record<string, unknown>, name = "Sana") => {
    const id = `wamid.CONV${Date.now()}${++seq}`;
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "0",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "15551556437", phone_number_id: phoneNumberId },
                contacts: [{ profile: { name }, wa_id: from }],
                messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(payload);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signPayload(body, appSecret) },
      body,
    });
    if (res.status !== 200) throw new Error(`webhook answered ${res.status}`);
    return id;
  };
  const text = (from: string, body: string, name?: string) => post(from, { type: "text", text: { body } }, name);
  const button = (from: string, id: string, title: string) =>
    post(from, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title } } });
  const location = (from: string, latitude: number, longitude: number) =>
    post(from, { type: "location", location: { latitude, longitude, name: "Home" } });

  const conversationOf = async (waId: string) =>
    waitFor(async () => {
      const { data } = await admin
        .from("whatsapp_conversations")
        .select("id, bot_enabled, bot_muted_until")
        .eq("restaurant_id", t.restaurantId)
        .eq("wa_id", waId)
        .maybeSingle();
      return data;
    }, 15_000);
  const outbound = async (conversationId: string) => {
    const { data } = await admin
      .from("whatsapp_messages")
      .select("id, type, body, status, error, created_at")
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound")
      .order("created_at");
    return data ?? [];
  };
  /** Waits for the bot's next reply (the n-th outbound message). */
  const reply = async (waId: string, n: number) => {
    const conv = await conversationOf(waId);
    if (!conv) return null;
    return waitFor(async () => (await outbound(conv.id))[n - 1]);
  };
  const buttons = (body: string | null | undefined) => [...(body ?? "").matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);

  try {
    // --- A. A full order: text → Delivery button → location pin → payment button → "bas" → Confirm
    log("A. full order");
    const a = "923001110001";
    await text(a, "2 zinger aur ek large tikka pizza");
    const r1 = await reply(a, 1);
    check("Order type buttons after the first items", buttons(r1?.body).join("|") === "🛵 Delivery|🛍️ Pickup", r1);
    await button(a, "order_type_delivery", "🛵 Delivery");
    const r2 = await reply(a, 2);
    check("Delivery tapped → bot asks for the address (no buttons)", !!r2 && buttons(r2.body).length === 0, r2);
    await location(a, 24.8138, 67.0299);
    const r3 = await reply(a, 3);
    check("Location pin saved → payment buttons", buttons(r3?.body).join("|") === "💵 Cash on delivery|💳 Card on delivery", r3);
    await button(a, "payment_cod", "💵 Cash on delivery");
    await reply(a, 4);
    await text(a, "bas");
    const r5 = await reply(a, 5);
    check(
      "Summary with the engine's total (Rs 1,100 + Rs 1,850 + Rs 150) and Confirm/Change/Cancel",
      (r5?.body ?? "").includes("Rs 3,100") && buttons(r5?.body).join("|") === "✅ Confirm|✏️ Change|❌ Cancel",
      r5?.body,
    );
    await button(a, "confirm", "✅ Confirm");
    const r6 = await reply(a, 6);
    check("Confirm → order received message", /^✅ Order #\d+ mil gaya!/.test(r6?.body ?? ""), r6?.body);
    const { data: cust } = await admin.from("customers").select("id").eq("restaurant_id", t.restaurantId).eq("phone", `+${a}`).single();
    const { data: orders } = await admin
      .from("orders")
      .select("order_number, total, delivery_fee, status, source, created_by, latitude, longitude")
      .eq("customer_id", cust!.id);
    check("Exactly one order", orders?.length === 1, orders);
    check(
      "Correct order: Rs 3,100 total, WhatsApp, waiting for acceptance, placed by the bot, with the pin",
      orders?.[0]?.total === 310000 && orders[0].delivery_fee === 15000 && orders[0].status === "awaiting_acceptance" && orders[0].source === "whatsapp" && orders[0].created_by === null && orders[0].latitude === 24.8138,
      orders?.[0],
    );
    check("Confirmation names the order number", (r6?.body ?? "").includes(`#${orders?.[0]?.order_number}`), r6?.body);

    // --- B–E run side by side (different customers).
    await Promise.all([
      (async () => {
        log("B. batching");
        const b = "923001110002";
        await text(b, "salam");
        await text(b, "2 naan");
        await text(b, "aur ek raita");
        const first = await reply(b, 1);
        await sleep(7_000);
        const conv = await conversationOf(b);
        const all = conv ? await outbound(conv.id) : [];
        const { data: logs } = await admin.from("ai_logs").select("input_text").eq("restaurant_id", t.restaurantId).ilike("input_text", "salam%");
        check("Batching: 3 quick messages → ONE bot reply", !!first && all.length === 1, all.map((x) => x.body));
        check("Batching: the bot read all 3 messages together", logs?.length === 1 && logs[0].input_text === "salam\n2 naan\naur ek raita", logs);
      })(),
      (async () => {
        log("C. handoff");
        const c = "923001110003";
        await text(c, "agent se baat karni hai");
        const r = await reply(c, 1);
        const conv = await conversationOf(c);
        check("Handoff: customer is told staff will reply", (r?.body ?? "").startsWith("Aap ki baat staff se karwa raha hoon"), r?.body);
        check("Handoff: bot switched off for this chat (Needs staff)", conv?.bot_enabled === false, conv);
        await text(c, "hello?");
        await sleep(8_000);
        check("Handoff: the bot stays quiet afterwards", (await outbound(conv!.id)).length === 1);
      })(),
      (async () => {
        log("D. flood limit");
        const d = "923001110004";
        await text(d, "spam 0"); // creates the chat first
        await Promise.all(Array.from({ length: 10 }, (_, i) => text(d, `spam ${i + 1}`)));
        await sleep(9_000);
        const conv = await conversationOf(d);
        const { data: flood } = await admin.from("ai_logs").select("id").eq("restaurant_id", t.restaurantId).eq("error_type", "flood");
        check("Flood: >10 messages a minute → no reply", conv ? (await outbound(conv.id)).length === 0 : false);
        check("Flood: chat muted for a minute and logged", !!conv?.bot_muted_until && (flood?.length ?? 0) >= 1, { conv, flood });
      })(),
      (async () => {
        log("E. voice note");
        const e = "923001110005";
        const id = await post(e, { type: "audio", audio: { id: "AUDFAKE1", mime_type: "audio/ogg; codecs=opus" } });
        const r = await reply(e, 1);
        const { data: saved } = await admin.from("whatsapp_messages").select("transcript, transcribe_provider").eq("wa_message_id", id).single();
        check("Voice note: transcript saved on the message", !!saved?.transcript && !!saved.transcribe_provider, saved);
        check("Voice note: reply starts with what the bot understood (🎤 Aap ne kaha: …)", (r?.body ?? "").startsWith("🎤 Aap ne kaha:"), r?.body);
        const { data: tlog } = await admin.from("ai_logs").select("id").eq("restaurant_id", t.restaurantId).eq("type", "transcription");
        check("Voice note: transcription logged in ai_logs", (tlog?.length ?? 0) >= 1, tlog?.length);
      })(),
      (async () => {
        log("F. voice note + text together");
        const f = "923001110006";
        await post(f, { type: "audio", audio: { id: "AUDFAKE2", mime_type: "audio/ogg; codecs=opus" } });
        await text(f, "bas jaldi");
        const first = await reply(f, 1);
        await sleep(6_000);
        const conv = await conversationOf(f);
        const all = conv ? await outbound(conv.id) : [];
        const { data: logs } = await admin
          .from("ai_logs")
          .select("input_text")
          .eq("restaurant_id", t.restaurantId)
          .eq("type", "chat")
          .ilike("input_text", "%bas jaldi%");
        check("Voice + text sent together → ONE bot turn", !!first && all.length === 1 && logs?.length === 1, { replies: all.length, logs });
        // Same-second WhatsApp messages have no reliable order: check both lines are there.
        const lines = (logs?.[0]?.input_text ?? "").split("\n");
        check(
          "The bot got the voice note as marked text + the typed text",
          lines.length === 2 && lines.some((l) => l.startsWith("[voice note] ")) && lines.includes("bas jaldi"),
          logs?.[0],
        );
      })(),
      (async () => {
        log("G. photo");
        const g = "923001110007";
        await post(g, { type: "image", image: { id: "IMGFAKE1", mime_type: "image/png" } });
        const r = await reply(g, 1);
        check("Photo → 'please type' reply", r?.body === "Abhi sirf text messages samajh sakta hoon, please type kar dein 🙏", r?.body);
      })(),
    ]);
  } finally {
    await admin
      .from("whatsapp_webhook_events")
      .delete()
      .contains("raw", { entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId } } }] }] });
    await t.cleanup();
  }
}
