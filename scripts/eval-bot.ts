/**
 * Bot evaluation against the REAL AI and a throwaway restaurant with the demo menu.
 *
 *   npm run eval:bot [-- --provider google|anthropic|groq] [--only id,category] [--delay 2000] [--verbose]
 *                    [--cases tests/bot-eval/corrections/<date>.json]
 *
 * Prints a score per category and overall, lists failures, and saves
 * test-results/bot-eval-<date>.json (with cost and latency per conversation).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import { runBotTurn, type BotTurnResult } from "../src/lib/bot/agent";
import { activeProvider, AI_PROVIDERS, modelFor, type AiProvider } from "../src/lib/bot/config";
import { createSupabaseBotStore } from "../src/lib/bot/store";
import { createBotTestRestaurant, type BotTestRestaurant } from "../src/lib/bot/testing/test-restaurant";
import { createOrder } from "../src/lib/orders/engine";

process.loadEnvFile(".env.local");

type ExpectedLine = { item: string; qty: number; size?: string | null; extras?: string[]; removals?: string[]; notes_include?: string };
type Turn = string[] | { button: string; text?: string };
type Case = {
  id: string;
  category: string;
  description?: string;
  branch?: "open" | "closed";
  customer?: { name?: string | null; previous_order?: boolean };
  turns: Turn[];
  expect: {
    cart?: ExpectedLine[];
    behavior?: "ask_clarification" | "handoff" | "refuse" | "closed_message" | "order_status" | "order_placed" | "not_on_menu" | "out_of_stock";
    reply_any?: string[];
    reply_none?: string[];
    order_type?: "delivery" | "pickup";
    address_landmark?: boolean;
    reply_script?: "urdu";
    order_total?: number;
    risk_flag?: boolean;
    customer_name?: string;
  };
};

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const providerArg = flag("provider");
if (providerArg && !(AI_PROVIDERS as readonly string[]).includes(providerArg)) {
  console.error(`--provider must be one of ${AI_PROVIDERS.join(", ")}`);
  process.exit(1);
}
const provider: AiProvider = (providerArg as AiProvider) ?? activeProvider();
const only = flag("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const delayMs = Number(flag("delay") ?? 0);
const verbose = args.includes("--verbose");
const casesFile = flag("cases") ?? "tests/bot-eval/cases.json";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin: SupabaseClient<Database> = createClient<Database>(url, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const store = createSupabaseBotStore(admin);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Options the engine picks by itself (required choice defaults) — ignored unless a case names them.
const DEFAULT_OPTIONS = new Set(["Medium"]);
const LEAK = /\b(I|S|O|L)\d{1,3}\b|search_menu|add_to_cart|show_order_summary|TRUTH RULES|system prompt says/;
const SOLD_OUT = ["sold out", "out of stock", "khatam", "available nahi", "nahi hai", "not available", "unavailable", "دستیاب نہیں", "ختم"];
const CLOSED = /band|closed|بند|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\d{1,2}:\d{2}/i;

const norm = (s: string) => s.trim().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.map(norm).sort().join("|") === b.map(norm).sort().join("|");

type CaseResult = {
  id: string;
  category: string;
  pass: boolean;
  problems: string[];
  replies: string[];
  tools: string[][];
  cart: unknown;
  costUsd: number;
  latencyMs: number;
  tokens: { input: number; output: number };
  rateLimited: number;
  errors: string[];
};

async function runCase(t: BotTestRestaurant, c: Case): Promise<CaseResult> {
  const customerId = await t.newCustomer({ name: c.customer?.name ?? null });
  if (c.customer?.previous_order) {
    const { data: cust } = await admin.from("customers").select("phone").eq("id", customerId).single();
    const prev = await createOrder(
      { admin, pricing: admin },
      { restaurantId: t.restaurantId, branchIds: null },
      {
        branchId: t.openBranchId,
        idempotencyKey: `eval-prev-${customerId}`,
        source: "whatsapp",
        orderType: "pickup",
        paymentMethod: "cod",
        customer: { phone: cust!.phone, name: c.customer.name ?? "" },
        lines: [{ itemId: t.itemIds["Zinger Burger"], quantity: 1 }],
      },
      { type: "bot", userId: null, role: null },
      { initialStatus: "preparing" },
    );
    if (!prev.ok) throw new Error(`previous order: ${prev.message}`);
  }
  const branchId = c.branch === "closed" ? t.closedBranchId : t.openBranchId;

  let sessionId: string | null = null;
  const replies: string[] = [];
  const tools: string[][] = [];
  const errors: string[] = [];
  let cost = 0;
  let latency = 0;
  const tokens = { input: 0, output: 0 };
  let rateLimited = 0;
  let last: BotTurnResult | null = null;

  for (const turn of c.turns) {
    const messages = Array.isArray(turn) ? turn : [turn.text ?? turn.button];
    const buttonId = Array.isArray(turn) ? null : turn.button;
    const res: BotTurnResult = await runBotTurn(
      { restaurantId: t.restaurantId, branchId, sessionId, customerId, customerMessages: messages, buttonId },
      { store, provider },
    );
    last = res;
    sessionId = res.sessionId;
    replies.push(res.replyText ?? "");
    tools.push(res.toolCalls.map((x) => `${x.tool}${x.output.ok ? "" : `!${(x.output as { error: string }).error}`}`));
    cost += res.estimatedCost;
    latency += res.latencyMs;
    tokens.input += res.usage.input;
    tokens.output += res.usage.output;
    if (res.error) {
      errors.push(`${res.error.type}: ${res.error.message.slice(0, 160)}`);
      // Rate limits and "provider busy" say nothing about quality: the case is re-run.
      if (res.error.type === "rate_limit" || /high demand|overloaded|unavailable|503/i.test(res.error.message)) rateLimited++;
    }
    if (verbose) {
      console.log(`    > ${messages.join(" / ")}${buttonId ? ` [${buttonId}]` : ""}`);
      console.log(`    < ${(res.replyText ?? "(no reply)").replace(/\n/g, "\n      ")}`);
      console.log(`      tools: ${tools.at(-1)!.join(", ") || "-"}`);
    }
  }

  const s = last!.session;
  const e = c.expect;
  const problems: string[] = [];
  const lastReply = (replies.at(-1) ?? "").toLowerCase();
  const allTools = tools.flat();

  if (e.cart) {
    const actual = s.cart.map((l) => ({
      item: l.name,
      qty: l.quantity,
      size: l.sizeName,
      extras: l.options.map((o) => o.name),
      removals: l.removals,
      notes: l.notes,
    }));
    const unmatched = [...actual];
    for (const want of e.cart) {
      const i = unmatched.findIndex((a) => {
        if (norm(a.item) !== norm(want.item) || a.qty !== want.qty) return false;
        if (want.size !== undefined && norm(a.size ?? "") !== norm(want.size ?? "")) return false;
        const wantExtras = want.extras ?? [];
        const gotExtras = a.extras.filter((x) => !DEFAULT_OPTIONS.has(x) || wantExtras.some((w) => norm(w) === norm(x)));
        if (!sameSet(gotExtras, wantExtras)) return false;
        if (!sameSet(a.removals, want.removals ?? [])) return false;
        if (want.notes_include && !norm(a.notes).includes(norm(want.notes_include))) return false;
        return true;
      });
      if (i < 0) problems.push(`missing cart line ${JSON.stringify(want)}`);
      else unmatched.splice(i, 1);
    }
    if (unmatched.length) problems.push(`unexpected cart lines ${JSON.stringify(unmatched)}`);
  }

  const handedOff = s.status === "handed_off";
  switch (e.behavior) {
    case "handoff":
      if (!handedOff) problems.push("expected handoff to staff");
      break;
    case "ask_clarification":
      if (handedOff) problems.push("handed off instead of asking");
      if (!/[?؟]/.test(lastReply)) problems.push("expected a question");
      break;
    case "closed_message":
      if (s.cart.length) problems.push("took items while closed");
      if (!CLOSED.test(lastReply)) problems.push("reply does not say closed / hours");
      break;
    case "order_status":
      if (!allTools.some((x) => x.startsWith("check_order_status"))) problems.push("did not check order status");
      break;
    case "order_placed": {
      if (!s.orderId) {
        problems.push("no order created");
        break;
      }
      const { data: order } = await admin.from("orders").select("total, status, source, risk_flag, order_type").eq("id", s.orderId).single();
      if (order?.status !== "awaiting_acceptance" || order?.source !== "whatsapp") problems.push(`order status/source wrong: ${JSON.stringify(order)}`);
      if (e.order_total !== undefined && order?.total !== e.order_total) problems.push(`order total ${order?.total} ≠ ${e.order_total}`);
      if (e.risk_flag !== undefined && !!order?.risk_flag !== e.risk_flag) problems.push(`risk flag ${order?.risk_flag ?? "none"}, expected ${e.risk_flag}`);
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", s.customerId!).eq("idempotency_key", `bot-${s.id}-${(s.summaryHash ?? "").slice(0, 16)}`);
      if ((count ?? 0) > 1) problems.push("more than one order");
      break;
    }
    case "refuse":
      if (s.orderId) problems.push("placed an order");
      break;
    case "not_on_menu":
      if (handedOff) problems.push("handed off instead of saying it's not on the menu");
      break;
    case "out_of_stock":
      if (!SOLD_OUT.some((w) => lastReply.includes(w))) problems.push("reply does not say sold out");
      break;
  }
  if (e.behavior !== "handoff" && e.behavior !== undefined && e.behavior !== "refuse" && handedOff && !problems.length) {
    problems.push("unexpected handoff");
  }
  if (e.behavior === undefined && handedOff) problems.push("unexpected handoff");
  if (e.behavior !== "order_placed" && s.orderId && e.behavior !== undefined) problems.push("unexpected order");

  if (e.order_type && s.orderType !== e.order_type) problems.push(`order type ${s.orderType} ≠ ${e.order_type}`);
  if (e.address_landmark !== undefined) {
    const has = !!s.address.landmark?.trim() || s.address.latitude != null;
    if (has !== e.address_landmark) problems.push(e.address_landmark ? "no landmark saved" : "saved an address without landmark as complete");
  }
  if (e.reply_any && !e.reply_any.some((w) => lastReply.includes(w.toLowerCase()))) problems.push(`reply has none of ${JSON.stringify(e.reply_any)}`);
  if (e.reply_none) {
    const hit = e.reply_none.find((w) => replies.join("\n").toLowerCase().includes(w.toLowerCase()));
    if (hit) problems.push(`reply contains "${hit}"`);
  }
  if (e.reply_script === "urdu" && !/[؀-ۿ]/.test(replies.at(-1) ?? "")) problems.push("reply is not in Urdu script");
  if (e.customer_name) {
    const { data: cust } = await admin.from("customers").select("name").eq("id", customerId).single();
    if (norm(cust?.name ?? "") !== norm(e.customer_name)) problems.push(`customer name ${cust?.name} ≠ ${e.customer_name}`);
  }
  const leak = replies.find((r) => LEAK.test(r));
  if (leak) problems.push(`leaked internal info: "${leak.match(LEAK)?.[0]}"`);
  if (errors.length && !problems.length) problems.push(`AI error: ${errors[0]}`);

  return {
    id: c.id,
    category: c.category,
    pass: problems.length === 0,
    problems,
    replies,
    tools,
    cart: s.cart.map((l) => `${l.quantity}× ${l.name}${l.sizeName ? ` (${l.sizeName})` : ""}${l.options.length ? ` +${l.options.map((o) => o.name).join("+")}` : ""}${l.removals.length ? ` -${l.removals.join("-")}` : ""}${l.notes ? ` [${l.notes}]` : ""}`),
    costUsd: cost,
    latencyMs: latency,
    tokens,
    rateLimited,
    errors,
  };
}

async function main() {
  const loaded = JSON.parse(readFileSync(casesFile, "utf8")) as (Case & { demo_menu?: boolean })[];
  // Exported corrections that use a real restaurant's items can't run on the demo menu.
  const all = loaded.filter((c) => c.demo_menu !== false);
  const cases = only ? all.filter((c) => only.includes(c.id) || only.includes(c.category)) : all;
  console.log(`Bot eval · ${provider} (${modelFor(provider)}) · ${cases.length} cases`);

  const t = await createBotTestRestaurant(admin, { url, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! }, "eval");
  const results: CaseResult[] = [];
  try {
    for (const c of cases) {
      let r: CaseResult | null = null;
      // A rate-limited run says nothing about quality: wait and run the case again (twice at most).
      for (let attempt = 0; attempt < 3; attempt++) {
        r = await runCase(t, c);
        if (!r.rateLimited || r.pass) break;
        console.log(`  … ${c.id} rate limited / provider busy, waiting 30s`);
        await sleep(30_000);
      }
      results.push(r!);
      console.log(`  ${r!.pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${c.id.padEnd(7)} ${c.category.padEnd(18)} ${r!.pass ? "" : r!.problems.join("; ")}`);
      if (delayMs) await sleep(delayMs);
    }
  } finally {
    await t.cleanup();
  }

  const byCat = new Map<string, { pass: number; total: number }>();
  for (const r of results) {
    const x = byCat.get(r.category) ?? { pass: 0, total: 0 };
    x.total++;
    if (r.pass) x.pass++;
    byCat.set(r.category, x);
  }
  const passed = results.filter((r) => r.pass).length;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const avg = (f: (r: CaseResult) => number) => (results.length ? results.reduce((s, r) => s + f(r), 0) / results.length : 0);
  const turns = results.reduce((s, r) => s + r.replies.length, 0);

  console.log("\nScore by category:");
  for (const [cat, x] of [...byCat].sort()) console.log(`  ${cat.padEnd(20)} ${x.pass}/${x.total}  (${pct(x.pass, x.total)}%)`);
  console.log(`\nOVERALL: ${passed}/${results.length} (${pct(passed, results.length)}%)`);
  console.log(
    `Per conversation: avg cost $${avg((r) => r.costUsd).toFixed(5)} · avg latency ${(avg((r) => r.latencyMs) / 1000).toFixed(1)}s · avg tokens in ${Math.round(avg((r) => r.tokens.input))} / out ${Math.round(avg((r) => r.tokens.output))}`,
  );
  console.log(`Per turn: avg latency ${(results.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, turns) / 1000).toFixed(1)}s · rate-limit hits: ${results.reduce((s, r) => s + r.rateLimited, 0)}`);

  const failures = results.filter((r) => !r.pass);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  ${f.id} (${f.category}): ${f.problems.join("; ")}`);
      console.log(`     cart: ${JSON.stringify(f.cart)} · tools: ${f.tools.map((x) => x.join(",")).join(" | ")}`);
      console.log(`     last reply: ${(f.replies.at(-1) ?? "").replace(/\n/g, " ⏎ ").slice(0, 220)}`);
    }
  }

  mkdirSync("test-results", { recursive: true });
  const file = `test-results/bot-eval-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  writeFileSync(
    file,
    JSON.stringify(
      {
        provider,
        model: modelFor(provider),
        ranAt: new Date().toISOString(),
        overall: { passed, total: results.length, percent: pct(passed, results.length) },
        categories: Object.fromEntries([...byCat].map(([k, v]) => [k, { ...v, percent: pct(v.pass, v.total) }])),
        averages: { costUsd: avg((r) => r.costUsd), latencyMs: avg((r) => r.latencyMs), inputTokens: avg((r) => r.tokens.input), outputTokens: avg((r) => r.tokens.output) },
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\nReport: ${file}`);
}

main().catch((err) => {
  console.error("\x1b[31mEval crashed:\x1b[0m", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
