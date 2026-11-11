import { MockLanguageModelV4 } from "ai/test";

/**
 * A deterministic, rule-based stand-in for the AI (TEST ONLY, enabled with
 * BOT_FAKE_AI=1 — never in production). It reads the compact menu from the
 * system prompt and turns simple keywords into REAL tool calls, so e2e tests
 * run the whole pipeline (tools, pricing, orders, WhatsApp) without an AI.
 *
 *   "2 zinger" / "ek large tikka pizza"  → add_to_cart
 *   "pickup" / "delivery"                → set_order_type
 *   "house|flat|plot … near X"           → set_delivery_address (landmark = "near X")
 *   "cash" / "card"                      → set_payment_method
 *   "naam Ali" / "my name is Ali"        → set_customer_name
 *   "bas" / "that's all" / "summary"     → show_order_summary (after the other tools)
 *   "confirm" / "haan"                   → confirm_order
 *   "agent" / "insaan" / "manager"       → handoff_to_staff
 */
type Part = { type: string; text?: string; toolName?: string; output?: { value?: unknown } };
type Msg = { role: string; content: string | Part[] };
type Call = { name: string; input: Record<string, unknown> };

const NUMBER_WORDS: Record<string, number> = { ek: 1, aik: 1, one: 1, a: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, four: 4, paanch: 5, five: 5 };
const SIZES = ["small", "medium", "large", "half", "full"];

type MenuLine = { ref: string; names: string[]; hasSizes: boolean };

function parseMenu(system: string): MenuLine[] {
  const out: MenuLine[] = [];
  for (const line of system.split("\n")) {
    const m = line.match(/^- (I\d+) ([^|(]+?)(?: \([^)]*\))? \|(.*)$/);
    if (!m) continue;
    const rest = m[3];
    const aliases = rest.match(/also called: ([^|]+)/)?.[1].split(",").map((a) => a.trim().toLowerCase()) ?? [];
    out.push({ ref: m[1], names: [m[2].trim().toLowerCase(), ...aliases].filter(Boolean), hasSizes: rest.includes("sizes:") });
  }
  return out;
}

function textOf(m: Msg): string {
  return typeof m.content === "string" ? m.content : m.content.map((p) => p.text ?? "").join(" ");
}

function itemCalls(text: string, menu: MenuLine[]): Call[] {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, " ")} `;
  const calls: Call[] = [];
  const used = new Set<string>();
  // Longest names first so "zinger deal" wins over "zinger".
  const candidates = menu
    .flatMap((m) => m.names.map((n) => ({ m, n })))
    .filter(({ n }) => n.length >= 3)
    .sort((a, b) => b.n.length - a.n.length);
  let rest = t;
  for (const { m, n } of candidates) {
    const at = rest.indexOf(` ${n} `);
    if (at < 0 || used.has(m.ref)) continue;
    used.add(m.ref);
    const before = rest.slice(0, at).trim().split(/\s+/).slice(-3);
    const qtyWord = [...before].reverse().find((w) => /^\d+$/.test(w) || w in NUMBER_WORDS);
    const quantity = qtyWord ? (/^\d+$/.test(qtyWord) ? Number(qtyWord) : NUMBER_WORDS[qtyWord]) : 1;
    const size = m.hasSizes ? [...before].reverse().find((w) => SIZES.includes(w)) : undefined;
    calls.push({ name: "add_to_cart", input: { item_id: m.ref, quantity, ...(size ? { variant_id: size } : {}) } });
    rest = rest.slice(0, at) + " ".repeat(n.length + 1) + rest.slice(at + n.length + 1);
  }
  return calls;
}

function decide(text: string, menu: MenuLine[]): { calls: Call[]; summary: boolean } {
  const t = text.toLowerCase();
  if (/\b(agent|insaan|manager|human)\b/.test(t)) return { calls: [{ name: "handoff_to_staff", input: { reason: "Customer asked for a person" } }], summary: false };
  if (/^\s*(confirm|haan|yes)\b/.test(t)) return { calls: [{ name: "confirm_order", input: {} }], summary: false };
  const calls = itemCalls(text, menu);
  if (/\bpickup\b/.test(t)) calls.push({ name: "set_order_type", input: { order_type: "pickup" } });
  const address = /\b(house|flat|plot|street)\b/.test(t);
  if (address) {
    const landmark = text.match(/\b((?:near|opposite|behind)\s+[^,.\n]+)/i)?.[1];
    calls.push({ name: "set_delivery_address", input: { address_text: text.split(/\b(?:near|opposite|behind)\b/i)[0].replace(/[,\s]+$/, ""), ...(landmark ? { landmark } : {}) } });
  } else if (/\bdelivery\b/.test(t)) calls.push({ name: "set_order_type", input: { order_type: "delivery" } });
  if (/\bcash\b/.test(t)) calls.push({ name: "set_payment_method", input: { payment_method: "cod" } });
  else if (/\bcard\b/.test(t)) calls.push({ name: "set_payment_method", input: { payment_method: "card_on_delivery" } });
  const name = text.match(/\b(?:naam|name is|i am|main)\s+([A-Z][a-z]+|[a-z]{3,})/i)?.[1];
  if (name) calls.push({ name: "set_customer_name", input: { name: name[0].toUpperCase() + name.slice(1) } });
  return { calls, summary: /\b(bas|that's all|thats all|summary)\b/.test(t) };
}

const QUESTION: Record<string, string> = {
  cart_empty: "Ji, kya order karna hai?",
  order_type: "Delivery ya pickup?",
  delivery_address: "Address aur qareebi nishani bata dein?",
  payment_method: "Payment cash on delivery ya card?",
  customer_name: "Aap ka naam bata dein?",
};

export function createFakeModel() {
  return new MockLanguageModelV4({
    provider: "fake",
    modelId: "fake-rules",
    doGenerate: async (options) => {
      const prompt = options.prompt as unknown as Msg[];
      const system = prompt.filter((m) => m.role === "system").map(textOf).join("\n");
      const menu = parseMenu(system);
      const lastUser = prompt.map((m, i) => ({ m, i })).filter(({ m }) => m.role === "user").at(-1);
      const userText = lastUser ? textOf(lastUser.m) : "";
      const sinceUser = lastUser ? prompt.slice(lastUser.i + 1) : [];
      const toolNames = sinceUser.flatMap((m) => (typeof m.content === "string" ? [] : m.content.filter((p) => p.type === "tool-call").map((p) => p.toolName)));
      const results = sinceUser.flatMap((m) => (typeof m.content === "string" ? [] : m.content.filter((p) => p.type === "tool-result")));

      const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };
      const reply = (text: string) => ({ content: [{ type: "text" as const, text }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });
      const call = (calls: Call[]) => ({
        content: calls.map((c, i) => ({ type: "tool-call" as const, toolCallId: `fake-${Date.now()}-${i}`, toolName: c.name, input: JSON.stringify(c.input) })),
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage,
        warnings: [],
      });

      const plan = decide(userText, menu);
      if (toolNames.length === 0) {
        if (plan.calls.length) return call(plan.calls);
        if (plan.summary) return call([{ name: "show_order_summary", input: {} }]);
        return reply("Ji, kya order karna hai? 🙂");
      }
      // Summary as its own step, after the other tools ran.
      if (plan.summary && !toolNames.includes("show_order_summary") && !toolNames.includes("handoff_to_staff")) {
        return call([{ name: "show_order_summary", input: {} }]);
      }
      const last = results.at(-1)?.output?.value as { ok?: boolean; message?: string; still_needed?: string[]; missing?: string[] } | undefined;
      if (last && last.ok === false) {
        const missing = last.missing?.[0];
        return reply(missing && QUESTION[missing] ? QUESTION[missing] : `Maazrat: ${last.message ?? "masla aa gaya"}`);
      }
      const next = last?.still_needed?.[0];
      return reply(next ? QUESTION[next] ?? "Aur kuch?" : "Theek hai 👍 Aur kuch chahiye?");
    },
  });
}
