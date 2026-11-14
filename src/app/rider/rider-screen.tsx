"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import {
  AlertCircle,
  Banknote,
  Bike,
  CheckCircle2,
  ChevronDown,
  LogOut,
  MapPin,
  MessageSquareText,
  Navigation,
  Package,
  Phone,
  PowerOff,
  ShoppingBag,
  Volume2,
  WifiOff,
  XCircle,
} from "lucide-react";
import { playChime, setSoundPreference, soundPreference, unlockAudio } from "@/components/orders/alert-sound";
import { UrduText } from "@/components/ui/urdu-text";
import { formatPKR, parseRupees } from "@/lib/money";
import { useLiveRefresh, useWakeLock } from "@/lib/realtime/use-live-refresh";
import { RIDER_FAIL_REASONS } from "@/lib/riders/core";
import { deliveredAction, deliveryFailedAction, pickedUpAction, setOnlineAction } from "@/lib/riders/actions";
import { fetchRiderHomeAction } from "@/lib/riders/home-action";
import { riderLogoutAction } from "@/lib/riders/login";
import type { RiderHome, RiderOrder } from "@/lib/riders/queries";
import { formatPhone } from "@/lib/orders/phone";

/**
 * The rider's phone screen (Phase 9). Big text, icons and colours; a few
 * Urdu words (Nastaliq) under the main buttons. Live: realtime on the
 * rider's own orders + polling, a chime and vibration when a new order arrives.
 */
const noopSubscribe = () => () => {};

/** "1× Beef Burger", "1× Beef Burger" → [{ qty: 2, name: "Beef Burger" }]. */
function groupItems(items: string[]) {
  const map = new Map<string, number>();
  for (const s of items) {
    const m = /^(\d+)\s*×\s*(.+)$/.exec(s);
    const name = m ? m[2] : s;
    map.set(name, (map.get(name) ?? 0) + (m ? Number(m[1]) : 1));
  }
  return [...map].map(([name, qty]) => ({ name, qty }));
}

export function RiderScreen({ initial }: { initial: RiderHome }) {
  const [home, setHome] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(initial.rider.isOnline);
  const storedSound = useSyncExternalStore(noopSubscribe, soundPreference, () => false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const sound = storedSound || soundEnabled;
  const [pending, start] = useTransition();
  const seen = useRef(new Set(initial.active.map((o) => o.id)));
  useWakeLock(true);

  async function refresh() {
    const next = await fetchRiderHomeAction().catch(() => null);
    if (!next) return;
    const fresh = next.active.filter((o) => !seen.current.has(o.id));
    next.active.forEach((o) => seen.current.add(o.id));
    if (fresh.length) {
      if (soundPreference()) playChime(true);
      navigator.vibrate?.([300, 150, 300]);
    }
    setHome(next);
  }
  const { online: connected, realtime } = useLiveRefresh({ table: "orders", filter: `rider_id=eq.${initial.rider.id}`, refresh });

  function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.message ?? r.error ?? "Something went wrong. Try again.");
      await refresh();
    });
  }

  function toggleOnline() {
    const next = !online;
    setOnline(next);
    run(async () => {
      const r = await setOnlineAction(next);
      if (!r.ok) setOnline(!next);
      return r;
    });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-page pb-28 text-ink" data-testid="rider-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-status-delivery-bg text-status-delivery-fg">
            <Bike aria-hidden className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold leading-tight">{home.rider.name}</p>
            <p className="line-clamp-2 text-sm leading-snug text-muted">
              {home.rider.restaurantName} · {home.rider.branchName}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={online}
            aria-label={online ? "You are online. Tap to go offline." : "You are offline. Tap to go online."}
            data-testid="online-toggle"
            disabled={pending}
            onClick={toggleOnline}
            className={`flex h-14 shrink-0 items-center gap-2 rounded-full border-2 pr-4 pl-2 text-base font-bold transition-colors disabled:opacity-70 ${
              online ? "border-whatsapp bg-status-ready-bg text-status-ready-fg" : "border-line-strong bg-subtle text-muted"
            }`}
          >
            <span className={`flex h-8 w-14 items-center rounded-full p-1 transition-colors ${online ? "justify-end bg-whatsapp" : "justify-start bg-line-strong"}`}>
              <span className="size-6 rounded-full bg-white shadow" />
            </span>
            {online ? "ONLINE" : "OFFLINE"}
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 pt-4">
        {!connected ? (
          <p className="flex items-center gap-2 rounded-card border border-status-awaiting-border bg-status-awaiting-bg px-3 py-2 text-sm font-semibold text-status-awaiting-fg" role="status">
            <WifiOff aria-hidden className="size-5 shrink-0" /> No internet — showing the last orders. We&apos;ll update when you&apos;re back.
          </p>
        ) : null}

        {!online ? (
          <button
            type="button"
            onClick={toggleOnline}
            disabled={pending}
            className="flex items-center gap-3 rounded-card border-2 border-dashed border-line-strong bg-surface p-3 text-left"
            data-testid="offline-hint"
          >
            <PowerOff aria-hidden className="size-6 shrink-0 text-muted" />
            <span className="flex-1">
              <span className="block font-bold">You are offline</span>
              <span className="block text-sm text-muted">You won&apos;t get new orders. Tap here to go ONLINE.</span>
            </span>
            <UrduText className="shrink-0 text-sm leading-loose text-muted">آن لائن ہوں</UrduText>
          </button>
        ) : null}

        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">My orders</h1>
          <span className="flex size-8 items-center justify-center rounded-full bg-ink text-sm font-bold text-white" data-testid="order-count">
            {home.active.length}
          </span>
          {realtime !== "live" && connected ? <span className="text-xs text-muted">updating…</span> : null}
          <span className="flex-1" />
          {!sound ? (
            <button
              type="button"
              onClick={async () => {
                if (await unlockAudio()) {
                  setSoundPreference(true);
                  setSoundEnabled(true);
                  playChime();
                }
              }}
              className="flex min-h-touch items-center gap-2 rounded-full border-2 border-urgent bg-status-awaiting-bg px-4 text-sm font-bold text-status-awaiting-fg"
            >
              <Volume2 aria-hidden className="size-4" /> Turn sound on
            </button>
          ) : (
            <span className="flex items-center gap-1 text-sm font-semibold text-status-ready-fg">
              <Volume2 aria-hidden className="size-4" /> Sound on
            </span>
          )}
        </div>

        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-card border border-status-cancelled-border bg-status-cancelled-bg p-3 font-semibold text-danger">
            <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" /> {error}
          </p>
        ) : null}

        {home.active.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-panel border border-line bg-surface px-6 py-10 text-center" data-testid="no-orders">
            <span className="flex size-16 items-center justify-center rounded-full bg-subtle">
              <Package aria-hidden className="size-8 text-muted" />
            </span>
            <p className="text-xl font-bold">No orders right now</p>
            <p className="text-muted">{online ? "New orders will ring here. Keep this screen open." : "Go ONLINE to get orders."}</p>
          </div>
        ) : (
          home.active.map((o) => <OrderCard key={o.id} order={o} pending={pending} run={run} />)
        )}

        {home.doneToday.length ? (
          <details className="group rounded-panel border border-line bg-surface">
            <summary className="flex min-h-touch-lg cursor-pointer list-none items-center gap-2 px-4 font-bold">
              <CheckCircle2 aria-hidden className="size-5 text-whatsapp" />
              <span className="flex-1">Done today ({home.doneToday.length})</span>
              <ChevronDown aria-hidden className="size-5 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <ul className="divide-y divide-line border-t border-line px-4">
              {home.doneToday.map((o) => (
                <li key={o.id} className="flex items-center gap-2 py-3">
                  {o.status === "failed" ? <XCircle aria-hidden className="size-5 text-danger" /> : <CheckCircle2 aria-hidden className="size-5 text-whatsapp" />}
                  <span className="font-bold">#{o.orderNumber}</span>
                  <span className="flex-1 truncate text-muted">{o.customerName}</span>
                  <span className="font-semibold">{o.codCollectedAmount != null ? formatPKR(o.codCollectedAmount) : o.status === "failed" ? "Failed" : "Paid"}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <form action={riderLogoutAction} className="py-4 text-center">
          <button type="submit" className="inline-flex min-h-touch items-center gap-2 rounded-full px-4 font-semibold text-muted hover:bg-subtle">
            <LogOut aria-hidden className="size-4" /> Log out
          </button>
        </form>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 bg-ink pb-[env(safe-area-inset-bottom)] text-white" data-testid="rider-summary">
        <div className="mx-auto grid max-w-lg grid-cols-2 gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-card bg-white/10">
              <Bike aria-hidden className="size-6 text-status-delivery-border" />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-white/70">Today</p>
              <p className="text-xl font-bold">
                {home.deliveriesToday} <span className="text-base font-semibold">{home.deliveriesToday === 1 ? "delivery" : "deliveries"}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-card bg-white/10">
              <Banknote aria-hidden className="size-6 text-urgent" />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-white/70">Cash in hand</p>
              <p className="truncate text-xl font-bold" data-testid="cash-in-hand">
                {formatPKR(home.cashInHand)}
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

type Run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => void;

const backLink = "min-h-touch font-semibold text-muted underline";

function OrderCard({ order: o, pending, run }: { order: RiderOrder; pending: boolean; run: Run }) {
  const onTheWay = o.status === "out_for_delivery";
  const [step, setStep] = useState<"none" | "cash" | "other-amount" | "failed">("none");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [failReason, setFailReason] = useState("");
  const [failNote, setFailNote] = useState("");
  const items = groupItems(o.items);

  return (
    <article
      className={`overflow-hidden rounded-panel border-2 bg-surface shadow-sm ${onTheWay ? "border-status-delivery-fg/50" : "border-status-ready-border"}`}
      data-testid="rider-order"
      data-order={o.orderNumber}
    >
      <div className={`flex items-center gap-2 px-4 py-3 ${onTheWay ? "bg-status-delivery-bg text-status-delivery-fg" : "bg-status-ready-bg text-status-ready-fg"}`}>
        {onTheWay ? <Bike aria-hidden className="size-6" /> : <Package aria-hidden className="size-6" />}
        <span className="flex-1 text-lg font-bold">{onTheWay ? "On the way" : "Food ready — pick up"}</span>
        <span className="text-2xl font-bold text-ink">#{o.orderNumber}</span>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <p className="text-2xl font-bold leading-tight">{o.customerName ?? "Customer"}</p>
          {o.area ? (
            <p className="flex items-center gap-1 text-lg font-bold text-brand-700">
              <MapPin aria-hidden className="size-5 shrink-0" /> {o.area}
            </p>
          ) : null}
          {o.addressText ? <p className="text-lg leading-snug">{o.addressText}</p> : null}
          {o.landmark ? <p className="text-base text-muted">Near: {o.landmark}</p> : null}
        </div>

        {items.length ? (
          <div className="rounded-card bg-subtle px-3 py-2">
            <p className="mb-1 text-xs font-bold tracking-wide text-muted uppercase">{o.itemCount} {o.itemCount === 1 ? "item" : "items"}</p>
            <ul className="flex flex-col gap-0.5">
              {items.map((it) => (
                <li key={it.name} className="flex gap-2 text-base">
                  <span className="min-w-7 font-bold">{it.qty}×</span>
                  <span>{it.name}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {o.notes ? (
          <p className="flex items-start gap-2 rounded-card border border-status-awaiting-border bg-status-awaiting-bg p-3 font-semibold text-status-awaiting-fg">
            <MessageSquareText aria-hidden className="mt-0.5 size-5 shrink-0" /> {o.notes}
          </p>
        ) : null}

        {o.paid ? (
          <div className="flex items-center gap-3 rounded-card border-2 border-status-ready-border bg-status-ready-bg p-3" data-testid="paid">
            <CheckCircle2 aria-hidden className="size-10 shrink-0 text-whatsapp" />
            <div>
              <p className="text-2xl font-bold text-status-ready-fg">PAID · Don&apos;t collect</p>
              <UrduText className="text-base leading-loose text-status-ready-fg">پیسے نہ لیں</UrduText>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-card border-2 border-urgent bg-status-awaiting-bg p-3" data-testid="collect">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-card bg-urgent">
              <Banknote aria-hidden className="size-8 text-ink" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center justify-between gap-2 font-semibold text-status-awaiting-fg">
                Collect cash <UrduText className="text-sm leading-loose">کیش لیں</UrduText>
              </p>
              <p className="text-4xl font-bold leading-tight">{formatPKR(o.toCollect)}</p>
            </div>
          </div>
        )}

        {o.customerPhone || o.mapsUrl ? (
          <div className="grid grid-cols-2 gap-3">
            {o.customerPhone ? (
              <a
                href={`tel:${o.customerPhone}`}
                className={`flex h-16 items-center justify-center gap-2 rounded-card border-2 border-whatsapp bg-status-ready-bg text-xl font-bold text-status-ready-fg active:scale-[0.98] ${o.mapsUrl ? "" : "col-span-2"}`}
                aria-label={`Call ${formatPhone(o.customerPhone)}`}
              >
                <Phone aria-hidden className="size-6" /> Call
              </a>
            ) : null}
            {o.mapsUrl ? (
              <a
                href={o.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className={`flex h-16 items-center justify-center gap-2 rounded-card border-2 border-status-accepted-fg bg-status-accepted-bg text-xl font-bold text-status-accepted-fg active:scale-[0.98] ${o.customerPhone ? "" : "col-span-2"}`}
              >
                <Navigation aria-hidden className="size-6" /> Map
              </a>
            ) : null}
          </div>
        ) : null}

        {step === "none" ? (
          onTheWay ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => (o.paid ? run(() => deliveredAction({ orderId: o.id, expectedVersion: o.version, amount: null })) : setStep("cash"))}
                className="flex min-h-20 flex-col items-center justify-center gap-0.5 rounded-card bg-whatsapp py-2 text-white shadow-sm active:scale-[0.98] disabled:opacity-60"
              >
                <span className="flex items-center gap-3 text-3xl font-bold">
                  <CheckCircle2 aria-hidden className="size-9" /> Delivered
                </span>
                <UrduText className="text-base leading-loose text-white/90">پہنچا دیا</UrduText>
              </button>
              <button type="button" onClick={() => setStep("failed")} className="min-h-touch font-semibold text-danger underline">
                Couldn&apos;t deliver?
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => pickedUpAction({ orderId: o.id, expectedVersion: o.version }))}
              className="flex min-h-20 flex-col items-center justify-center gap-0.5 rounded-card bg-brand-700 py-2 text-white shadow-sm active:scale-[0.98] disabled:opacity-60"
            >
              <span className="flex items-center gap-3 text-3xl font-bold">
                <ShoppingBag aria-hidden className="size-9" /> Picked up
              </span>
              <UrduText className="text-base leading-loose text-white/90">کھانا لے لیا</UrduText>
            </button>
          )
        ) : null}

        {step === "cash" ? (
          <div className="flex flex-col gap-3 rounded-card border-2 border-whatsapp bg-status-ready-bg/40 p-3" data-testid="cash-confirm">
            <p className="text-xl font-bold">Did you get {formatPKR(o.toCollect)} cash?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deliveredAction({ orderId: o.id, expectedVersion: o.version, amount: o.toCollect }))}
                className="flex h-16 items-center justify-center gap-2 rounded-card bg-whatsapp text-2xl font-bold text-white disabled:opacity-60"
              >
                <CheckCircle2 aria-hidden className="size-7" /> Yes
              </button>
              <button type="button" onClick={() => setStep("other-amount")} className="h-16 rounded-card border-2 border-line-strong bg-surface text-lg font-bold">
                Different amount
              </button>
            </div>
            <button type="button" onClick={() => setStep("none")} className={backLink}>
              Back
            </button>
          </div>
        ) : null}

        {step === "other-amount" ? (
          <div className="flex flex-col gap-3 rounded-card border-2 border-urgent bg-status-awaiting-bg/40 p-3">
            <label className="flex flex-col gap-1 text-lg font-bold">
              Cash you got (Rs)
              <input
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                className="h-14 rounded-control border-2 border-line-strong bg-surface px-3 text-2xl outline-none focus:border-brand-700"
                aria-label="Cash collected in rupees"
              />
            </label>
            <label className="flex flex-col gap-1 font-bold">
              Why different?
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-14 rounded-control border-2 border-line-strong bg-surface px-3 text-lg font-normal outline-none focus:border-brand-700"
                placeholder="e.g. customer had no change"
              />
            </label>
            <button
              type="button"
              disabled={pending || !amount || !reason.trim()}
              onClick={() => {
                const paisa = parseRupees(amount);
                if (paisa === null) return;
                run(() => deliveredAction({ orderId: o.id, expectedVersion: o.version, amount: paisa, reason }));
              }}
              className="h-16 rounded-card bg-whatsapp text-2xl font-bold text-white disabled:opacity-50"
            >
              Save · Delivered
            </button>
            <button type="button" onClick={() => setStep("cash")} className={backLink}>
              Back
            </button>
          </div>
        ) : null}

        {step === "failed" ? (
          <div className="flex flex-col gap-2 rounded-card border-2 border-status-cancelled-border p-3" data-testid="fail-reasons">
            <p className="text-xl font-bold">Why couldn&apos;t you deliver?</p>
            {RIDER_FAIL_REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={failReason === r.value}
                onClick={() => setFailReason(r.value)}
                className={`flex min-h-14 items-center justify-between gap-3 rounded-card border-2 px-4 text-left text-lg font-semibold ${
                  failReason === r.value ? "border-danger bg-status-cancelled-bg" : "border-line bg-surface"
                }`}
              >
                {r.label}
                <UrduText className="text-sm leading-loose text-muted">{r.urdu}</UrduText>
              </button>
            ))}
            {failReason === "other" ? (
              <input
                value={failNote}
                onChange={(e) => setFailNote(e.target.value)}
                placeholder="What happened?"
                className="h-14 rounded-control border-2 border-line-strong px-3 text-lg outline-none focus:border-brand-700"
              />
            ) : null}
            <button
              type="button"
              disabled={pending || !failReason || (failReason === "other" && !failNote.trim())}
              onClick={() => run(() => deliveryFailedAction({ orderId: o.id, expectedVersion: o.version, reason: failReason, note: failNote }))}
              className="h-16 rounded-card bg-danger text-xl font-bold text-white disabled:opacity-50"
            >
              Mark as failed
            </button>
            <button type="button" onClick={() => setStep("none")} className={backLink}>
              Back
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
