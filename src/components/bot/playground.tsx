"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bot, ExternalLink, Play, RotateCcw, Send, ShoppingCart, Wrench } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { formatPKR } from "@/lib/money";
import { formatPhone } from "@/lib/orders/phone";
import { cn } from "@/lib/utils";
import {
  listPlaygroundCustomersAction,
  sendPlaygroundMessageAction,
  startPlaygroundAction,
  type PlaygroundCustomer,
  type PlaygroundSession,
  type PlaygroundTurn,
} from "@/lib/bot/playground-actions";
import type { BotButton } from "@/lib/bot/agent";

type RestaurantOption = { id: string; name: string; branches: { id: string; name: string; isOpen: boolean }[] };
type ChatEntry = { role: "customer" | "bot" | "system"; text: string; buttons?: BotButton[] | null };

const URDU = /[؀-ۿ]/;

/** WhatsApp formatting: *bold* → bold (plain React text, no HTML). */
function withBold(text: string) {
  return text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
    part.length > 2 && part.startsWith("*") && part.endsWith("*") ? <strong key={i}>{part.slice(1, -1)}</strong> : part,
  );
}

export function BotPlayground({ restaurants }: { restaurants: RestaurantOption[] }) {
  const [restaurantId, setRestaurantId] = useState(restaurants[0]?.id ?? "");
  const restaurant = restaurants.find((r) => r.id === restaurantId);
  const [branchId, setBranchId] = useState(restaurant?.branches[0]?.id ?? "");
  const [customerMode, setCustomerMode] = useState<"new" | "existing">("new");
  const [newName, setNewName] = useState("");
  const [customers, setCustomers] = useState<PlaygroundCustomer[]>([]);
  const [existingId, setExistingId] = useState("");

  const [session, setSession] = useState<PlaygroundSession | null>(null);
  const [customer, setCustomer] = useState<PlaygroundCustomer | null>(null);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [lastTurn, setLastTurn] = useState<PlaygroundTurn | null>(null);
  const [totals, setTotals] = useState({ turns: 0, cost: 0, latency: 0, input: 0, output: 0 });
  const [orders, setOrders] = useState<{ id: string; orderNumber: number }[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [chat.length, pending]);

  useEffect(() => {
    if (!restaurantId) return;
    let alive = true;
    void listPlaygroundCustomersAction({ restaurantId }).then((r) => {
      if (!alive) return;
      setCustomers(r.ok ? r.data ?? [] : []);
      setExistingId(r.ok ? r.data?.[0]?.id ?? "" : "");
    });
    return () => {
      alive = false;
    };
  }, [restaurantId]);

  function begin(customerChoice: { mode: "new"; name?: string } | { mode: "existing"; customerId: string }) {
    start(async () => {
      setError(null);
      const r = await startPlaygroundAction({ restaurantId, branchId, customer: customerChoice });
      if (!r.ok || !r.data) {
        setError(r.ok ? "Couldn't start." : r.error);
        return;
      }
      setSession(r.data.session);
      setCustomer(r.data.customer);
      setChat([{ role: "system", text: `New session · ${r.data.customer.name || "unnamed customer"} · ${formatPhone(r.data.customer.phone)}` }]);
      setLastTurn(null);
      setTotals({ turns: 0, cost: 0, latency: 0, input: 0, output: 0 });
    });
  }

  function send(messages: string[], button?: BotButton) {
    if (!session || !customer || messages.length === 0) return;
    setChat((c) => [...c.map((e) => ({ ...e, buttons: null })), ...messages.map((text) => ({ role: "customer" as const, text }))]);
    setDraft("");
    start(async () => {
      setError(null);
      const r = await sendPlaygroundMessageAction({
        restaurantId,
        branchId,
        sessionId: session.id,
        customerId: customer.id,
        messages,
        buttonId: button?.id,
      });
      if (!r.ok || !r.data) {
        setError(r.ok ? "No answer." : r.error);
        return;
      }
      const t = r.data;
      setLastTurn(t);
      setSession(t.session);
      setTotals((x) => ({
        turns: x.turns + 1,
        cost: x.cost + t.estimatedCost,
        latency: x.latency + t.latencyMs,
        input: x.input + t.usage.input,
        output: x.output + t.usage.output,
      }));
      if (t.orderCreated) setOrders((o) => [t.orderCreated!, ...o]);
      setChat((c) => [
        ...c,
        t.replyText
          ? { role: "bot", text: t.replyText, buttons: t.showButtons }
          : { role: "system", text: t.handedOff ? "Handed off to staff — the bot stays quiet in this chat." : "(no reply)" },
        ...(t.error ? [{ role: "system" as const, text: `AI ${t.error.type}: ${t.error.message.slice(0, 200)}` }] : []),
      ]);
    });
  }

  const subtotal = useMemo(() => session?.cart.reduce((s, l) => s + l.lineTotal, 0) ?? 0, [session]);

  return (
    <div className="flex flex-col gap-4">
      <Card padding="md" className="grid gap-3 md:grid-cols-[1fr_1fr_auto_1fr_auto] md:items-end">
        <Select
          label="Restaurant"
          value={restaurantId}
          onChange={(e) => {
            setRestaurantId(e.target.value);
            setBranchId(restaurants.find((r) => r.id === e.target.value)?.branches[0]?.id ?? "");
          }}
          options={restaurants.map((r) => ({ value: r.id, label: r.name }))}
        />
        <Select
          label="Branch"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          options={(restaurant?.branches ?? []).map((b) => ({ value: b.id, label: `${b.name}${b.isOpen ? "" : " (closed)"}` }))}
        />
        <div>
          <p className="mb-1.5 text-sm font-semibold">Customer</p>
          <Tabs
            variant="segmented"
            aria-label="Customer"
            value={customerMode}
            onValueChange={setCustomerMode}
            items={[
              { value: "new", label: "New" },
              { value: "existing", label: "Existing" },
            ]}
          />
        </div>
        {customerMode === "new" ? (
          <Input label="Name (optional)" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Leave empty: the bot asks" />
        ) : (
          <Select
            label="Existing customer"
            value={existingId}
            onChange={(e) => setExistingId(e.target.value)}
            placeholder={customers.length ? undefined : "No customers yet"}
            options={customers.map((c) => ({ value: c.id, label: `${c.name || "No name"} · ${formatPhone(c.phone)} · ${c.totalOrders} orders` }))}
          />
        )}
        <Button
          icon={<Play />}
          loading={pending && !session}
          disabled={!branchId || (customerMode === "existing" && !existingId)}
          onClick={() => begin(customerMode === "new" ? { mode: "new", name: newName || undefined } : { mode: "existing", customerId: existingId })}
        >
          Start chat
        </Button>
      </Card>

      {error ? <Alert>{error}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card padding="none" className="flex min-h-[70dvh] flex-col overflow-hidden">
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Bot aria-hidden className="size-5 text-whatsapp" />
            <p className="flex-1 font-bold">{customer ? `${customer.name || "New customer"} · ${formatPhone(customer.phone)}` : "Start a chat"}</p>
            {customer ? (
              <Button
                variant="secondary"
                icon={<RotateCcw />}
                disabled={pending}
                onClick={() => begin({ mode: "existing", customerId: customer.id })}
              >
                Reset session
              </Button>
            ) : null}
          </header>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-[#efeae2] p-3" aria-live="polite">
            {chat.map((e, i) =>
              e.role === "system" ? (
                <p key={i} className="self-center rounded-control bg-surface/80 px-3 py-1 text-center text-xs text-muted">
                  {e.text}
                </p>
              ) : (
                <div key={i} className={cn("flex flex-col gap-1.5", e.role === "customer" ? "items-end" : "items-start")}>
                  <p
                    dir="auto"
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap wrap-break-word rounded-card px-3 py-2 text-sm shadow-card",
                      e.role === "customer" ? "bg-[#d9fdd3]" : "bg-surface",
                      URDU.test(e.text) && "font-urdu leading-loose",
                    )}
                  >
                    {withBold(e.text)}
                  </p>
                  {e.buttons?.length ? (
                    <div className="flex max-w-[85%] flex-wrap gap-1.5">
                      {e.buttons.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          disabled={pending}
                          onClick={() => send([b.title], b)}
                          className="min-h-touch rounded-card border border-line bg-surface px-4 text-sm font-semibold text-[#027eb5] shadow-card hover:bg-subtle disabled:opacity-50"
                        >
                          {b.title}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ),
            )}
            {pending && session ? <p className="self-start rounded-card bg-surface px-3 py-2 text-sm text-muted shadow-card">typing…</p> : null}
            <div ref={end} />
          </div>
          <form
            className="flex items-end gap-2 border-t border-line bg-surface p-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft.split("\n").map((l) => l.trim()).filter(Boolean));
            }}
          >
            <textarea
              aria-label="Message"
              dir="auto"
              rows={2}
              value={draft}
              disabled={!session || pending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={session ? "Type like a customer… (Shift+Enter = new line = separate message)" : "Start a chat first"}
              className="min-h-touch flex-1 resize-none rounded-control border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
            <Button type="submit" icon={<Send />} disabled={!session || pending || !draft.trim()}>
              Send
            </Button>
          </form>
        </Card>

        <aside className="flex flex-col gap-3" aria-label="Bot state">
          <Card padding="md" className="flex flex-col gap-2">
            <p className="flex items-center gap-2 font-bold">
              <ShoppingCart aria-hidden className="size-4" /> Cart
            </p>
            {session?.cart.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {session.cart.map((l) => (
                  <li key={l.lineId} className="flex justify-between gap-2">
                    <span>
                      <span className="text-muted">{l.lineId}</span> {l.quantity}× {l.name}
                      {l.sizeName ? ` (${l.sizeName})` : ""}
                      {l.options.length ? <span className="text-muted"> + {l.options.map((o) => o.name).join(", ")}</span> : null}
                      {l.removals.length ? <span className="text-danger"> no {l.removals.join(", ")}</span> : null}
                      {l.notes ? <span className="block text-xs text-muted">Note: {l.notes}</span> : null}
                    </span>
                    <span className="shrink-0 font-semibold">{formatPKR(l.lineTotal)}</span>
                  </li>
                ))}
                <li className="flex justify-between border-t border-line pt-1 font-bold">
                  <span>Subtotal (pricing engine)</span>
                  <span>{formatPKR(subtotal)}</span>
                </li>
              </ul>
            ) : (
              <p className="text-sm text-muted">Empty</p>
            )}
          </Card>

          <Card padding="md" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <span className="text-muted">Status</span>
            <span>
              <Badge tone={session?.status === "handed_off" ? "cancelled" : session?.status === "completed" ? "ready" : "neutral"}>{session?.status ?? "—"}</Badge>
            </span>
            <span className="text-muted">Stage</span>
            <span className="font-semibold">{session?.stage ?? "—"}</span>
            <span className="text-muted">Language</span>
            <span>{session?.language ?? "—"}</span>
            <span className="text-muted">Order type</span>
            <span>{session?.orderType ?? "—"}</span>
            {session?.orderType === "delivery" ? (
              <>
                <span className="text-muted">Address</span>
                <span>{[session.address.text, session.address.area, session.address.landmark && `near: ${session.address.landmark}`].filter(Boolean).join(", ") || "—"}</span>
              </>
            ) : null}
            <span className="text-muted">Payment</span>
            <span>{session?.paymentMethod ?? "—"}</span>
            {session?.handoffReason ? (
              <>
                <span className="text-muted">Handoff</span>
                <span>{session.handoffReason}</span>
              </>
            ) : null}
          </Card>

          {orders.length ? (
            <Alert tone="success" title="Orders created">
              {orders.map((o) => (
                <Link key={o.id} href="/orders" target="_blank" className="flex items-center gap-1 font-semibold underline">
                  Order #{o.orderNumber} on /orders <ExternalLink aria-hidden className="size-3.5" />
                </Link>
              ))}
            </Alert>
          ) : null}

          <Card padding="md" className="flex flex-col gap-2 text-sm">
            <p className="flex items-center gap-2 font-bold">
              <Wrench aria-hidden className="size-4" /> This turn
            </p>
            {lastTurn ? (
              <>
                <p className="text-muted">
                  {lastTurn.provider} · {lastTurn.model || "no AI call"} · {(lastTurn.latencyMs / 1000).toFixed(1)}s · in {lastTurn.usage.input} / out{" "}
                  {lastTurn.usage.output} tokens{lastTurn.usage.cacheRead ? ` · cached ${lastTurn.usage.cacheRead}` : ""} · ${lastTurn.estimatedCost.toFixed(5)}
                </p>
                {lastTurn.toolCalls.length ? (
                  <ol className="flex flex-col gap-1">
                    {lastTurn.toolCalls.map((c, i) => {
                      const out = c.output as { ok?: boolean; error?: string };
                      return (
                        <li key={i}>
                          <details>
                            <summary className={cn("cursor-pointer font-mono text-xs", out.ok === false && "text-danger")}>
                              {c.tool}
                              {out.ok === false ? ` → ${out.error}` : " ✓"} <span className="text-muted">{c.ms}ms</span>
                            </summary>
                            <pre className="mt-1 max-h-60 overflow-auto rounded-control bg-subtle p-2 text-[11px] leading-snug">
                              {JSON.stringify({ input: c.input, output: c.output }, null, 2)}
                            </pre>
                          </details>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="text-muted">No tool calls.</p>
                )}
              </>
            ) : (
              <p className="text-muted">Send a message to see tool calls, tokens, cost and latency.</p>
            )}
            {totals.turns ? (
              <p className="border-t border-line pt-2 text-muted">
                Session: {totals.turns} turns · avg {(totals.latency / totals.turns / 1000).toFixed(1)}s · {totals.input} in / {totals.output} out tokens · $
                {totals.cost.toFixed(5)}
              </p>
            ) : null}
          </Card>
        </aside>
      </div>
    </div>
  );
}
